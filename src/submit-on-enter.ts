import type { KeyboardEvent } from "react";

/** For message/feedback boxes, not document editors. Shift always stays multiline. */
export function submitOnEnter(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
) {
  if (
    event.key !== "Enter" ||
    event.shiftKey ||
    event.altKey ||
    event.nativeEvent.isComposing ||
    // Safari can clear isComposing on the Enter that commits an IME candidate.
    event.nativeEvent.keyCode === 229
  )
    return;

  // Includes the old Cmd/Ctrl+Enter shortcuts. Consume blocked/repeated submits
  // too, so they neither insert an unexpected newline nor reach a parent form.
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) submit();
}
