import { ApiError, proposeQuestions } from '$lib/server/jev';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	let payload: { description?: string };
	try {
		payload = await request.json();
	} catch {
		return json({ message: 'JSON non valido' }, { status: 400 });
	}

	try {
		const questions = await proposeQuestions(payload.description ?? '');
		return json({ questions });
	} catch (e) {
		if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
		throw e;
	}
};
