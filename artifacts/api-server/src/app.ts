import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Browser clients use the same origin. Reject cross-site state changes while
// allowing bearer-authenticated native clients with no Origin header.
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        res.status(403).json({ error: "Cross-origin request rejected." });
        return;
      }
    } catch {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
  }
  next();
});
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

if (process.env.NODE_ENV === "production") {
  const publicDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../sema-app/dist/public",
  );
  app.use(express.static(publicDirectory));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(publicDirectory, "index.html"));
  });
}

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error(
      "Request failed; inspect service health and database configuration.",
    );
    if (!res.headersSent)
      res
        .status(500)
        .json({ error: "The request could not be completed. Please retry." });
  },
);

export default app;
