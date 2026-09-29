(function(){
  function uid(){ return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function loadDb(){
    try{ return JSON.parse(sessionStorage.getItem('__mock_supabase_db__')) || { users: {}, exercises: [], entries: [], user_settings: [] }; }
    catch(e){ return { users: {}, exercises: [], entries: [], user_settings: [] }; }
  }
  function saveDb(db){ sessionStorage.setItem('__mock_supabase_db__', JSON.stringify(db)); }

  function createClient(){
    let listeners = [];

    // Real supabase-js persists the session token in localStorage, not a separate
    // store, so wiping localStorage (simulating a lost/reset phone) correctly signs
    // the user out too, while the "cloud" data below (sessionStorage, standing in for
    // the actual remote database) survives and is restored on the next sign-in.
    function loadSessionUser(){
      try{ return JSON.parse(localStorage.getItem('__mock_supabase_session__')); }catch(e){ return null; }
    }
    function saveSessionUser(user){
      try{
        if(user) localStorage.setItem('__mock_supabase_session__', JSON.stringify(user));
        else localStorage.removeItem('__mock_supabase_session__');
      }catch(e){}
    }
    function notify(event, session){ listeners.forEach(cb => cb(event, session)); }
    function sessionFor(user){ return user ? { user: { id: user.id, email: user.email } } : null; }

    setTimeout(() => { notify('INITIAL_SESSION', sessionFor(loadSessionUser())); }, 0);

    class Builder {
      constructor(table){ this.table = table; this.filters = []; this.op = null; this._single = false; this._maybeSingle = false; }
      select(cols){ if(!this.op) this.op = 'select'; this.selectCols = cols; return this; }
      eq(col, val){ this.filters.push([col, val]); return this; }
      single(){ this._single = true; return this; }
      maybeSingle(){ this._maybeSingle = true; return this; }
      upsert(payload, opts){ this.op = 'upsert'; this.payload = payload; this.onConflict = opts && opts.onConflict; return this; }
      delete(){ this.op = 'delete'; return this; }
      then(resolve, reject){ this.exec().then(resolve, reject); }
      async exec(){
        const db = loadDb();
        const rows = db[this.table] || (db[this.table] = []);
        if(this.op === 'upsert'){
          const keys = (this.onConflict || 'id').split(',');
          const idx = rows.findIndex(r => keys.every(k => r[k] === this.payload[k]));
          let row;
          if(idx >= 0){ row = Object.assign(rows[idx], this.payload); }
          else { row = Object.assign({ id: uid() }, this.payload); rows.push(row); }
          saveDb(db);
          return { data: this._single ? row : [row], error: null };
        }
        if(this.op === 'delete'){
          db[this.table] = rows.filter(r => !this.filters.every(([c,v]) => r[c] === v));
          saveDb(db);
          return { data: null, error: null };
        }
        const matched = rows.filter(r => this.filters.every(([c,v]) => r[c] === v));
        if(this._single) return { data: matched[0] || null, error: matched[0] ? null : { message: 'no rows' } };
        if(this._maybeSingle) return { data: matched[0] || null, error: null };
        return { data: matched, error: null };
      }
    }

    return {
      auth: {
        onAuthStateChange(cb){ listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
        async signUp({ email, password }){
          const db = loadDb();
          if(db.users[email]) return { data: { session: null }, error: { message: 'User already registered' } };
          const user = { id: uid(), email, password };
          db.users[email] = user;
          saveDb(db);
          saveSessionUser(user);
          const session = sessionFor(user);
          notify('SIGNED_IN', session);
          return { data: { session, user: session.user }, error: null };
        },
        async signInWithPassword({ email, password }){
          const db = loadDb();
          const user = db.users[email];
          if(!user || user.password !== password) return { data: { session: null }, error: { message: 'Invalid login credentials' } };
          saveSessionUser(user);
          const session = sessionFor(user);
          notify('SIGNED_IN', session);
          return { data: { session }, error: null };
        },
        async signOut(){
          saveSessionUser(null);
          notify('SIGNED_OUT', null);
          return { error: null };
        },
      },
      from(table){ return new Builder(table); },
    };
  }

  window.supabase = { createClient };
})();
