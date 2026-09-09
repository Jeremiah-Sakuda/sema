import test from "node:test";
import assert from "node:assert/strict";
import { googleConfiguration, GoogleCloudProvider, parseBeats } from "../src/lib/google-cloud";
import { encodeWave, parseWave, narrationStem } from "../src/lib/wave";
import { hasProtectedCollision, narrationWindows, verifyRenderedFit } from "../src/lib/timing";
import { audibleIntervals } from "../src/lib/media";
import { verifiedExport, audioHash } from "../src/lib/processing";
import { state, routes, sdk } from "./fixtures";
import "./routes.mjs";

const configuration = {
  GOOGLE_CLOUD_PROJECT_ID: "sema-test-project",
  GOOGLE_CLOUD_LOCATION: "us-central1",
  // A deliberately invalid key, used only with the isolated authentication stub.
  GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "test@sema-test-project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nTEST_ONLY", token_uri: "https://untrusted.invalid/token" }),
};
const beat = { start: 1, end: 2, summary: "A door opens", description: "A woman opens the door.", importance: "high", reason: "Visible action", characters: [], objects: ["door"] };

test("project route guard rejects anonymous decisions and exports and another owner", async () => {
  const guard = routes.find(route => route.method === "use" && route.path === "/projects/:projectId")!.handler;
  state.project = { ownerId: "owner" };
  for (const request of [
    { method: "PATCH", path: "/beats/beat-1/decision", user: undefined, expected: 401 },
    { method: "POST", path: "/export", user: undefined, expected: 401 },
    { method: "GET", path: "/export/sema-narration.wav", user: undefined, expected: 401 },
    { method: "PATCH", path: "/beats/beat-1/decision", user: { id: "other" }, expected: 403 },
    { method: "GET", path: "/review", user: { id: "other" }, expected: 403 },
  ]) {
    let status = 0, continued = false;
    const response = { status(code: number) { status = code; return this; }, json() {} };
    await guard({ ...request, params: { projectId: "project-1" }, isAuthenticated: () => Boolean(request.user) }, response, () => { continued = true; });
    assert.equal(status, request.expected);
    assert.equal(continued, false);
  }
  let continued = false;
  await guard({ method: "GET", params: { projectId: "project-1" }, user: { id: "owner" }, isAuthenticated: () => true }, {}, () => { continued = true; });
  assert.equal(continued, true);
});

test("decision handler refuses candidate and window rows from another project", async () => {
  const handler = routes.find(route => route.method === "patch" && route.path.endsWith("/decision"))!.handler;
  for (const foreign of ["candidate", "window"]) {
    state.rows = {
      beats: [{ beatId: "beat-1", projectId: "project-1" }],
      candidates: [{ candidateId: "candidate-1", projectId: foreign === "candidate" ? "other-project" : "project-1", windowId: "window-1" }],
      windows: [{ windowId: "window-1", projectId: foreign === "window" ? "other-project" : "project-1" }],
    };
    let status = 0;
    const response = { headersSent: false, status(code: number) { status = code; return this; }, json() {} };
    await handler({ params: { projectId: "project-1", beatId: "beat-1" }, body: { candidateId: "candidate-1", action: "approve" }, user: { id: "owner" }, isAuthenticated: () => true }, response, () => {});
    assert.equal(status, 404);
  }
});

test("export binds the exact approved candidate, wording, audio and protected placement", async () => {
  function reset() {
    state.audio = encodeWave(Buffer.alloc(48000));
    state.project = { status: "needs_review", duration: 5, mediaObjectPath: "/objects/source" };
    state.rows = {
      beats: [{ beatId: "beat-1", evidenceFrames: ["frame-1"] }],
      windows: [{ windowId: "window-1", start: 1, end: 3, protectedCollision: false }],
      candidates: [{ candidateId: "candidate-1", beatId: "beat-1", windowId: "window-1", fitStatus: "pass", text: "A door opens." }],
      decisions: [{ beatId: "beat-1", candidateId: "candidate-1", action: "approve", exportAuthorized: true, finalText: "A door opens.", reviewer: "owner", updatedAt: new Date() }],
      processing: [{ manifest: { source: "/objects/source", protectedIntervals: [], renders: { "candidate-1": { text: "A door opens.", objectPath: "/objects/audio", sha256: audioHash(state.audio) } } } }],
    };
  }
  reset();
  const valid = await verifiedExport("project");
  assert.equal(valid.entries.length, 1);
  assert.equal(parseWave(valid.audio).duration, 5);
  const mutations = [
    () => { state.rows.decisions[0].candidateId = "other-candidate"; },
    () => { state.rows.candidates[0].beatId = "other-beat"; },
    () => { state.rows.decisions[0].finalText = "Unrendered edit."; },
    () => { state.rows.candidates[0].text = "Another revision."; },
    () => { state.rows.processing[0].manifest.source = "/objects/old-source"; },
    () => { state.audio = encodeWave(Buffer.alloc(48002)); },
    () => { state.rows.processing[0].manifest.protectedIntervals = [{ start: 2, end: 4 }]; },
    () => { state.rows.decisions[0].exportAuthorized = false; },
    () => { state.rows.decisions = []; },
    () => { state.rows.decisions.push({ ...state.rows.decisions[0] }); },
    () => { state.rows.windows[0].end = 1.5; },
  ];
  for (const mutate of mutations) { reset(); mutate(); await assert.rejects(verifiedExport("project")); }
  reset(); state.rows.decisions[0].action = "left_undescribed";
  const omitted = await verifiedExport("project");
  assert.equal(omitted.entries.length, 0);
  assert.equal(omitted.decisions.length, 1, "intentional omissions remain in the ledger");
});

test("configuration requires the three secret values and strips untrusted auth URLs", () => {
  assert.throws(() => googleConfiguration({}), /Replit Secrets/);
  assert.deepEqual(Object.keys(googleConfiguration(configuration).credentials).sort(), ["client_email", "private_key"]);
  for (const env of [
    { ...configuration, GOOGLE_CLOUD_PROJECT_ID: "../other-project" },
    { ...configuration, GOOGLE_CLOUD_LOCATION: "host.invalid/path" },
    { ...configuration, GOOGLE_CLOUD_VERTEX_MODEL: "model?key=secret" },
    { ...configuration, GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: "invalid-json" },
    { ...configuration, GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "external_account" }) },
  ]) assert.throws(() => googleConfiguration(env));
});

test("visual evidence rejects malformed, out-of-film and oversized model output", () => {
  assert.equal(parseBeats({ beats: [beat] }, 3)[0].summary, beat.summary);
  for (const invalid of [{ ...beat, start: -1 }, { ...beat, end: 4 }, { ...beat, end: NaN }, { ...beat, characters: [42] }, { ...beat, summary: " " }]) {
    assert.throws(() => parseBeats({ beats: [invalid] }, 3));
  }
  assert.throws(() => parseBeats({ beats: Array(31).fill(beat) }, 3));
});

test("sample measurement and stem placement preserve audio and silence", () => {
  const samples = Buffer.alloc(24000 * 2); samples.writeInt16LE(900, 0);
  const audio = encodeWave(samples);
  assert.equal(parseWave(audio).duration, 1);
  const stem = parseWave(narrationStem(3, [{ start: 1, audio }]));
  assert.equal(stem.duration, 3);
  assert.equal(stem.pcm.readInt16LE(0), 0);
  assert.equal(stem.pcm.readInt16LE(48000), 900);
  assert.throws(() => narrationStem(3, [{ start: 1, audio }, { start: 1.5, audio }]), /overlaps/);
  assert.throws(() => narrationStem(1.5, [{ start: 1, audio }]), /exceeds/);
  assert.throws(() => parseWave(audio.subarray(0, audio.length - 2)), /Invalid/);
  const stereo = Buffer.from(audio); stereo.writeUInt16LE(2, 22);
  assert.throws(() => parseWave(stereo), /mono/);
});

test("fit validation fails closed for collision, invalid measurement and overlong narration", () => {
  const window = { start: 1, end: 3 };
  assert.equal(verifyRenderedFit({ window, renderedDuration: 1.8 }).status, "pass");
  assert.equal(verifyRenderedFit({ window, renderedDuration: 1.81 }).status, "failed");
  assert.equal(verifyRenderedFit({ window, renderedDuration: 1, protectedCollision: true }).status, "blocked");
  for (const renderedDuration of [0, -1, Infinity, NaN]) assert.equal(verifyRenderedFit({ window, renderedDuration }).status, "failed");
  assert.equal(hasProtectedCollision(window, [{ start: 3.1, end: 4 }]), true);
  assert.deepEqual(narrationWindows([{ start: 1, end: 2 }, { start: 1.8, end: 3 }], 5), [{ start: 0, end: 0.75 }, { start: 3.25, end: 5 }]);
  const pcm = Buffer.alloc(3200); pcm.writeInt16LE(1000, 1800);
  assert.deepEqual(audibleIntervals(pcm), [{ start: 0.05, end: 0.1 }]);
});

test("Google calls use Vertex, require timestamps and measure returned synthesis", async () => {
  const previousEnv = Object.fromEntries(Object.keys(configuration).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, configuration);
  try {
    const calls: { url: string; body: any }[] = [];
    let response: unknown;
    sdk.generate = async () => response;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-access-token");
      return new Response(JSON.stringify(response), { status: 200 });
    }) as typeof fetch;
    const provider = new GoogleCloudProvider();
    assert.equal(sdk.configuration.vertexai, true);
    assert.equal(sdk.configuration.project, configuration.GOOGLE_CLOUD_PROJECT_ID);
    assert.equal(sdk.configuration.location, configuration.GOOGLE_CLOUD_LOCATION);
    assert.equal(sdk.configuration.googleAuthOptions.credentials.token_uri, undefined);
    response = { results: [{ alternatives: [{ transcript: "Hello", words: [{ startTime: "0.1s", endTime: "0.5s" }] }] }] };
    assert.deepEqual((await provider.transcribe(Buffer.alloc(32000), 10)).intervals, [{ start: 10.1, end: 10.5 }]);
    response = { results: [{ alternatives: [{ transcript: "Hello" }] }] };
    await assert.rejects(provider.transcribe(Buffer.alloc(32000), 0), /without timestamps/);
    response = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ beats: [beat] }) }] } }] };
    assert.equal((await provider.analyze(Buffer.from("video"), 3, "hello")).length, 1);
    assert.equal(sdk.calls.at(-1).model, "gemini-2.5-flash");
    assert.equal(sdk.calls.at(-1).contents[0].parts[0].inlineData.mimeType, "video/mp4");
    assert.equal(sdk.calls.at(-1).config.responseMimeType, "application/json");
    response = { candidates: [{ finishReason: "MAX_TOKENS" }] };
    await assert.rejects(provider.analyze(Buffer.from("video"), 3, ""), /incomplete/);
    response = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "A door opens." }] } }] };
    assert.equal(await provider.shorten("A woman slowly opens the wooden door.", 1.5), "A door opens.");
    assert.equal(await provider.shorten("Door.", 1.5), "", "a longer revision cannot trigger another synthesis");
    response = { candidates: [{ finishReason: "MAX_TOKENS" }] };
    await assert.rejects(provider.shorten("A woman opens a door.", 1), /incomplete/);
    response = { audioContent: encodeWave(Buffer.alloc(48000)).toString("base64") };
    assert.equal(parseWave(await provider.synthesize("A door opens.")).duration, 1);
    response = { audioContent: Buffer.from("not wave").toString("base64") };
    await assert.rejects(provider.synthesize("A door opens."), /Invalid/);
    globalThis.fetch = async () => { throw new Error("sensitive-provider-content"); };
    await assert.rejects(provider.synthesize("A door opens."), error => error instanceof Error && !error.message.includes("sensitive-provider-content"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
