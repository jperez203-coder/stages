/**
 * Shared "Coming soon" body for portal tabs that aren't built yet.
 * Phase 4b-1.
 *
 * Used by:
 *   * Canvas tab (slice 4b-2)
 *   * Files tab (slice 4b-3 / files feature)
 *
 * Centered title + body in the available space below the tabs.
 * Tone is friendly, not apologetic — these are real upcoming features
 * the client should expect.
 */

type Props = {
  title: string;
  body: string;
};

export function PortalPlaceholder({ title, body }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        gap: 8,
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "white",
          margin: 0,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.55)",
          margin: 0,
          maxWidth: 380,
          lineHeight: 1.5,
        }}
      >
        {body}
      </p>
    </div>
  );
}
