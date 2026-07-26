export function featureEnabled(envName: string): boolean {
	return process.env[envName] !== "0";
}
