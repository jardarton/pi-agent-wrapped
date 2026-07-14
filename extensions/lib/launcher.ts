function normalizeEnvLauncher(value: string | undefined): string[] | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return [trimmed];
}

export function getPiInvocationParts(): string[] {
	const envLauncher = normalizeEnvLauncher(process.env.PI_LAUNCHER_BIN);
	if (envLauncher) return envLauncher;

	throw new Error("This Pi-native child operation requires PI_LAUNCHER_BIN from the active wrapper.");
}
