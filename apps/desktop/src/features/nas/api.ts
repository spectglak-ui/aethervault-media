import { invoke } from "@tauri-apps/api/core";

/** 0.4.0 — Support NAS (SMB/UNC) : connexion + test de partage. */
export const nasApi = {
  test: (server: string, share: string) =>
    invoke<void>("nas_test_connection", { server, share }),
  connect: (
    server: string,
    share: string,
    username: string | null,
    password: string | null
  ) => invoke<string>("nas_connect", { server, share, username, password }),
};