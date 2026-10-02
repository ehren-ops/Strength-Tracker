// Startup, once every js/ file has loaded. Event wiring lives here, not in the files that define
// the handlers: the browser can run a callback between two script files loading, and the
// handlers call functions from across the app (render, the coach, deload checks). Every network
// sync waits on the session from onAuthStateChange, so nothing syncs before this point.

supabaseClient.auth.onAuthStateChange((event, session) => {
  const wasSignedIn = !!currentSession;
  currentSession = session;
  if(!session) didReconcileThisSession = false;
  renderSyncStatus();
  if(view === "overview") render();
  if(session && !wasSignedIn) syncOnSignIn();
});
window.addEventListener("online", () => { renderSyncStatus(); flushQueue(); });
window.addEventListener("offline", () => { renderSyncStatus(); });
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "visible"){ checkRestTimerCompletion(); checkDeloadAutoEnd(); }
});

// The Next tile's guidance lines depend on the font; refit once the web font is in.
if(document.fonts && document.fonts.ready) document.fonts.ready.then(fitGuidance);

render();
checkDeloadAutoEnd();
