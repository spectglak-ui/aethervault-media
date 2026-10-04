import { invoke } from "@tauri-apps/api/core";

/** Tag du coffre privé (0.6.3). `count` = utilisations tous médias. */
export interface PrivateTag {
  id: number;
  name: string;
  count: number;
}
export interface PrivateMediaTag {
  media_id: number;
  tag_id: number;
  name: string;
}
export type PrivateTagKind = "image" | "video";

export const privateTagsApi = {
  list: () => invoke<PrivateTag[]>("private_list_tags"),
  forMedia: (kind: PrivateTagKind, mediaIds: number[]) =>
    invoke<PrivateMediaTag[]>("private_tags_for_media", { kind, mediaIds }),
  add: (kind: PrivateTagKind, mediaId: number, name: string) =>
    invoke<PrivateTag>("private_add_tag", { kind, mediaId, name }),
  remove: (kind: PrivateTagKind, mediaId: number, tagId: number) =>
    invoke<void>("private_remove_tag", { kind, mediaId, tagId }),
  deleteTag: (tagId: number) => invoke<void>("private_delete_tag", { tagId }),
};