import { ApiError, suggestState } from '$lib/server/jev';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let payload: { description?: string; questions?: Record<string, unknown> };
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'JSON non valido' }, { status: 400 });
	}

	try {
		const result = await suggestState(payload.description ?? '', payload.questions ?? {});
		return json(result);
	} catch (e) {
		if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
		throw e;
	}
};
