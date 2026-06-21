export function hasSharedSecret(got: string | null, want: string): boolean {
	if (!got || !want) return false;
	return timingSafeEqual(got, want);
}

function timingSafeEqual(a: string, b: string): boolean {
	const enc = new TextEncoder();
	const aBytes = enc.encode(a);
	const bBytes = enc.encode(b);
	if (aBytes.length !== bBytes.length) return false;

	let diff = 0;
	for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];

	return diff === 0;
}
