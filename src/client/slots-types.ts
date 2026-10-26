/** The minimal slot surface the plugin consumes (structural — the host owns
 *  the real one; this is the subset every registration call needs). */
export interface SlotsLike {
	inject(slot: string, setup: () => unknown): void;
	register(options: Record<string, unknown>, component: unknown): () => void;
}
