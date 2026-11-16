/**
 * A tool's output as the person reads it.
 *
 * igni-core quarantines external content for the model by wrapping a tool's
 * text result in `<untrusted_tool_output nonce=…>` … `</untrusted_tool_output
 * nonce=…>` (core/hooks/untrusted.py `wrap_untrusted`), and the wrapped text
 * is what `tool_completed.full_result` and the saved history carry. The tags
 * are for the model; a tool card showed them round every output (R647).
 *
 * Only a leading block with matching nonces is removed, as the backend's own
 * `unwrap_untrusted` reads it. Text after the closing tag (a hook message, a
 * rules suffix) is igni's own and stays.
 */

const WRAPPED = /^<untrusted_tool_output nonce=([0-9a-f]+)>\n([\s\S]*?)\n<\/untrusted_tool_output nonce=\1>/;

export function toolOutputForDisplay(text: string): string {
  return text.replace(WRAPPED, "$2");
}
