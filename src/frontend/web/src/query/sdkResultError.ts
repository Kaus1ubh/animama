/** A generated SDK call result read with `throwOnError: false`. */
export type SdkResult = { error?: unknown; response?: Response };

/**
 * The error to throw for a failed generated SDK result.
 *
 * The generated client returns a request that never received a response
 * (connection loss, an abort, or a request a paused runtime scope refused) as
 * `{ error, response: undefined }`. That failure has no HTTP status and does
 * not show the server rejected anything, so it stays a transport error for the
 * caller's connection or uncertain-outcome handling, as in the content save and
 * package sharing APIs. An HTTP failure goes through `toHttpError`.
 */
export function sdkResultError(
  result: SdkResult,
  toHttpError: (status: number, error: unknown) => Error,
): Error {
  if (!result.response)
    return result.error instanceof Error
      ? result.error
      : new TypeError("Failed to fetch");
  return toHttpError(result.response.status, result.error);
}
