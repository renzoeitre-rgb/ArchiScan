/**
 * Utility for triggering browser downloads of text/blob data.
 * This encapsulates the DOM-level orchestration of file exports.
 */
export function downloadFile(content: string, fileName: string, mimeType: string = 'text/markdown') {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;
	a.click();
	URL.revokeObjectURL(url);
}
