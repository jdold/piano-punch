export function requestMicrophone(getUserMedia, timeoutMs = 15_000) {
  let expired = false;
  let timeoutId;
  const request = getUserMedia({ audio: true });
  // getUserMedia cannot be cancelled. Stop any stream Safari resolves too late.
  request.then((lateStream) => {
    if (expired) lateStream.getTracks().forEach((track) => track.stop());
  }, () => {});

  return Promise.race([
    request,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        expired = true;
        reject(Object.assign(new Error('Microphone permission request timed out'), { name: 'TimeoutError' }));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export function microphoneErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return 'Microphone permission is blocked. Allow microphone access for this site in iPhone Settings, then tap Try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'No microphone was found. Connect or enable a microphone, then tap Try again.';
  if (error?.name === 'TimeoutError' || /timed? ?out|timeout/i.test(error?.message || '')) return 'Safari did not start the microphone in time. Check this site’s microphone permission and close other apps using the mic, then tap Try again.';
  if (error?.name === 'NotReadableError' || error?.name === 'AbortError') return 'The microphone could not start. It may be in use by another app. Close that app and tap Try again.';
  return `Microphone setup failed${error?.message ? ` (${error.message})` : ''}. Practice time will not count until listening works. Tap Try again.`;
}
