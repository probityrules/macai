import { describe, it, expect } from "vitest";
import { parseEmbeddedToolCalls, resolveToolCalls } from "../src/agent/parseToolCalls.js";

describe("parseEmbeddedToolCalls", () => {
  it("parses function + parameter XML", () => {
    const content = `
I'll list the directory:
<function=list_directory>
<parameter=path>
src
</parameter>
</function>
</tool_call>
`;
    expect(parseEmbeddedToolCalls(content)).toEqual([
      { function: { name: "list_directory", arguments: { path: "src" } } },
    ]);
  });

  it("parses write_file with multiline content", () => {
    const content = `<function=write_file>
<parameter=path>
tests/foo.test.ts
</parameter>
<parameter=content>
import { describe, it, expect } from "vitest";
describe("foo", () => {
  it("works", () => expect(1).toBe(1));
});
</parameter>
</function>`;
    const calls = parseEmbeddedToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("write_file");
    expect(calls[0].function.arguments.path).toBe("tests/foo.test.ts");
    expect(String(calls[0].function.arguments.content)).toContain('expect(1).toBe(1)');
  });

  it("parses parameter name= attribute form", () => {
    const content = `<function=write_file>
<parameter name="path">tests/x.test.ts</parameter>
<parameter name="content">export {}</parameter>
</function>`;
    expect(parseEmbeddedToolCalls(content)).toEqual([
      {
        function: {
          name: "write_file",
          arguments: { path: "tests/x.test.ts", content: "export {}" },
        },
      },
    ]);
  });
});

describe("resolveToolCalls", () => {
  it("prefers native tool_calls", () => {
    const native = [{ function: { name: "read_file", arguments: { path: "a.ts" } } }];
    expect(
      resolveToolCalls({
        content: "<function=write_file><parameter=path>x</parameter></function>",
        tool_calls: native,
      }),
    ).toEqual(native);
  });

  it("falls back to embedded XML", () => {
    expect(
      resolveToolCalls({
        content: "<function=git_status></function>",
        tool_calls: [],
      }),
    ).toEqual([{ function: { name: "git_status", arguments: {} } }]);
  });
});
