import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		port: 5179,
		strictPort: true,   // fail loudly if 5179 is already taken
		host: '0.0.0.0'
	}
});
