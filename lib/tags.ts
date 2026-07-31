/**
 * Phase 13: a real tag registry over the free-text strings already stored on
 * `transaction_annotations.tags`. Renaming and merging are the same
 * operation server-side (`rename_user_tag` in the migration): renaming a tag
 * to a name that already exists in the registry merges the two, since a
 * tag's identity is its name, not a row id.
 */

const MAX_TAG_LENGTH = 40;

export type TagNameResult = { ok: true; value: string } | { ok: false; error: string };

export function validateTagName(input: unknown): TagNameResult {
  if (typeof input !== "string") return { ok: false, error: "name must be a string" };
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: "name must not be empty" };
  if (trimmed.length > MAX_TAG_LENGTH) {
    return { ok: false, error: `name must be at most ${MAX_TAG_LENGTH} characters` };
  }
  return { ok: true, value: trimmed };
}

export interface TagRenamePlan {
  oldName: string;
  newName: string;
  /** True when the target name already exists — this rename is really a merge. */
  isMerge: boolean;
}

export type TagRenameResult = { ok: true; value: TagRenamePlan } | { ok: false; error: string };

/** Validates a rename/merge request against the caller's existing tag names. */
export function planTagRename(
  oldNameInput: unknown,
  newNameInput: unknown,
  existingNames: string[],
): TagRenameResult {
  const oldResult = validateTagName(oldNameInput);
  if (!oldResult.ok) return { ok: false, error: `old name: ${oldResult.error}` };
  const newResult = validateTagName(newNameInput);
  if (!newResult.ok) return { ok: false, error: `new name: ${newResult.error}` };

  if (!existingNames.includes(oldResult.value)) {
    return { ok: false, error: "tag not found" };
  }
  if (oldResult.value === newResult.value) {
    return { ok: false, error: "new name must differ from the current name" };
  }

  return {
    ok: true,
    value: {
      oldName: oldResult.value,
      newName: newResult.value,
      isMerge: existingNames.includes(newResult.value),
    },
  };
}
