import { SetMetadata } from "@nestjs/common";
import { OrgRole } from "@flowforge/shared";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
export const RequireRole = (...roles: OrgRole[]) =>
  SetMetadata(ROLES_KEY, roles);