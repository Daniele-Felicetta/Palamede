import { ApiError, decide } from '$lib/server/jev';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let payload: { state?: string; questions?: Record<string, unknown> };
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'JSON non valido' }, { status: 400 });
	}

	try {
		const result = await decide(payload.state ?? '', payload.questions ?? {});
		return json(result);
	} catch (e) {
		if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
		throw e;
	}
};
