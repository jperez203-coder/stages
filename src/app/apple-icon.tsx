import { ImageResponse } from "next/og";

/**
 * iOS home screen icon. 180×180 PNG with the Stages cascading-bars logo
 * centered on the app's #212124 dark surface. iOS rounds the corners
 * automatically, so the source is a hard-edged square.
 *
 * Generated at build time via Next.js's `ImageResponse` (Satori under
 * the hood) — paths are the same coordinates as the inline
 * <StagesLogo /> component, so the home screen icon and the in-app
 * header logo render identically.
 *
 * Modern browsers use icon.svg (favicon); only iOS / Safari pinned-tab
 * scenarios hit this PNG. icon.svg → apple-icon.tsx is the standard
 * Next.js 16 metadata file convention (see app-icons.md in next docs).
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#212124",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="60 60 210 210"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M212.083 80.0451L84.2083 60.0716L81.9167 71.6541L81 84.7068V98.2256L81.9167 110.812L82.8333 122L212.083 114.541L213 101.955V88.4361L212.083 80.0451Z"
            fill="#DF1E5A"
          />
          <path
            d="M144.688 133.09L240.594 119.05L242.312 127.192L243 136.367V145.87L242.312 154.717L240.938 166L144.688 163.009L144 148.491V138.989L144.688 133.09Z"
            fill="#E273C1"
          />
          <path
            d="M73.9062 212.896L75.2656 223L187.188 208.085L188.094 204.236L189 194.613V178.736L187.188 172H75.2656L73.9062 181.142L73 196.057L73.9062 212.896Z"
            fill="#21B159"
          />
          <path
            d="M116.452 254.603L117.356 261H245.74L248 241.353V229.931L247.548 217.138L246.192 208L220.877 212.112L117.356 227.647L116.452 232.433L116 241.353L116.452 254.603Z"
            fill="#36C5EF"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
