import { Icon } from "./chrome";
import { useCopy } from "./ui";

/** A value to copy (the MCP URL, a token's secret): the text in mono, a Copy button at its end. */
export function CopyField({ value, label, id }: { value: string; label: string; id?: string }) {
  const copied = useCopy();
  return (
    <span className="copy-field">
      <code id={id}>{value}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={`Copy ${label}`}
        title={copied.state === "copied" ? "Copied" : "Copy"}
        onClick={() => void copied.copy(value)}
      >
        <Icon name={copied.state === "copied" ? "check" : "copy"} />
      </button>
    </span>
  );
}
