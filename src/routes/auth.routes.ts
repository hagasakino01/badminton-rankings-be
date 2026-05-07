import { Router } from "express";

import { changePassword, login, me, register, updateProfile } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/authMiddleware";

const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", requireAuth, me);
authRouter.put("/me", requireAuth, updateProfile);
authRouter.post("/change-password", requireAuth, changePassword);

export { authRouter };
