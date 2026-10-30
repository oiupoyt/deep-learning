const LEARNING_TURN_ENDING_TOOLS = new Set([
	"probe",
	"quiz",
	"recall",
	"explain",
	"probe_done",
	"problem",
]);

/** Whether a learning tool deliberately hands control back to the learner. */
export function concludesLearningToolTurn(name: string): boolean {
	return LEARNING_TURN_ENDING_TOOLS.has(name);
}
