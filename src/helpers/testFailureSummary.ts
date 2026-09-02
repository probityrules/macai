/**
 * Compress noisy test-runner output so the agent sees real failures.
 * Vitest runs often bury FAIL sections under git CRLF warnings; slicing the
 * head of the log hides the errors entirely.
 */
export function summarizeTestFailureOutput(output: string, maxChars = 4000): string {
  const trimmed = output.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "(no test output)";

  const withoutCrLfNoise = trimmed
    .split("\n")
    .filter(
      (line) =>
        !/^warning: LF will be replaced by CRLF/i.test(line) &&
        !/^The file will have its original line endings/i.test(line),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const source = withoutCrLfNoise || trimmed;

  const failIdx = source.search(/Failed Tests|FAIL\s+\S|⎯+.*Failed/i);
  if (failIdx >= 0) {
    const fromFail = source.slice(failIdx);
    if (fromFail.length <= maxChars) return fromFail;
    return `${fromFail.slice(0, maxChars)}\n\n[... failure output truncated ...]`;
  }

  if (source.length <= maxChars) return source;
  return `${source.slice(-maxChars)}\n\n[... showing last ${maxChars} chars of output ...]`;
}
