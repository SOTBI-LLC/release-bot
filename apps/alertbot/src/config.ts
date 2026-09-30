export function positiveInteger(value: string, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('invalid_configuration');
	return parsed;
}
