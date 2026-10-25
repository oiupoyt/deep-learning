/**
 * The confidence rail — the original's paint, ported: a #141414 base,
 * SOLID stop ticks as background layers UNDER the fill, fill transparent
 * past the value, and the six-step ramp (0 red → 100 emerald).
 */

import * as React from "react";

export const CONFIDENCE_STOPS: readonly number[] = [0, 30, 50, 70, 90, 100];

/** The six-step ramp (the original's exact colors). */
export const CONFIDENCE_COLORS: readonly string[] = [
	"#ef4444", // 0
	"#f97316", // 30
	"#eab308", // 50
	"#84cc16", // 70
	"#22c55e", // 90
	"#10b981", // 100
];

export function railColor(value: number): string {
	const idx = CONFIDENCE_STOPS.indexOf(value);
	return CONFIDENCE_COLORS[idx >= 0 ? idx : 2]!;
}

/** The static rail (the answered-card form: no disc). */
export function ConfidenceRail({ value }: { value: number }): React.ReactElement {
	return React.createElement(
		"div",
		{
			className: "dl-confidence-track",
			style: {
				backgroundColor: "#141414",
				backgroundImage: [
					`linear-gradient(90deg, ${railColor(value)} 0%, ${railColor(value)} ${value}%, transparent ${value}%, transparent 100%)`,
					...[30, 50, 70, 90].map(() => "linear-gradient(90deg, rgba(230,230,230,0.35), rgba(230,230,230,0.35))"),
				].join(", "),
				backgroundSize: ["100% 100%", "1px 100%", "1px 100%", "1px 100%", "1px 100%"].join(", "),
				backgroundPosition: ["0 0", ...[30, 50, 70, 90].map((p) => `${p}% 0`)].join(", "),
				backgroundRepeat: "no-repeat",
			},
		},
	);
}
