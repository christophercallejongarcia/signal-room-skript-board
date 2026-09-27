/**
 * Next start hook. Only the Skript-Board uses it (PLAN.md points 34b, 34c):
 * with BOARD_ACCESS_TOKEN set, this process takes its instance lock, repairs
 * run journals of dead Next processes and starts the delivery loop.
 * Without the token (plain Signal Room) nothing happens.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.BOARD_ACCESS_TOKEN) return;
    const { chatBackground } = await import("./lib/board/chat-run");
    try {
      chatBackground();
    } catch (error) {
      console.error(`Skript-Board: Lauf-Hintergrund nicht gestartet (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
}
