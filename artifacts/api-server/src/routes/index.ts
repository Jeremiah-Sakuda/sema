import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import semaRouter from "./sema";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(semaRouter);

export default router;
