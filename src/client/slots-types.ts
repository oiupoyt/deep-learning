/** The minimal slot surface the plugin consumes (structural — the host owns
 *  the real one; this is the subset every registration call needs). */
export interface SlotsLike {
  inject(slot: string, setup: () => unknown): void;
  register(options: Record<string, unknown>, component: unknown): () => void;
}

export interface ClientContextLike {
  get?(name: string): unknown;
  inject?(dependencies: string[], setup: (context: ClientContextLike) => void): void;
  effect?(effect: () => void | (() => void), label?: string): void;
  slots?: SlotsLike;
  shortcuts?: { register(command: Record<string, unknown>): () => void };
  sidebarRight?: {
    openTabIn(sessionId: string, kind: string, options?: { params?: Record<string, unknown> }): void;
    commandTarget(element: Element | null): { sessionId: string } | undefined;
    openTabFromTarget(kind: string, target: { sessionId: string }): void;
  };
  sidebarRightTabs?: { register(definition: Record<string, unknown>): () => void };
}

export interface ActivityOwnerProps {
  sessionId?: string;
  locked: boolean;
  onActiveChange(active: boolean): void;
}
