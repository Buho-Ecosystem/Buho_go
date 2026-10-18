// [seconds since inject, what, visibility] for every logged event.
JSON.stringify((window.__atLog || []).map((e) => [Math.round((e.t - window.__atStart) / 1000), e.what, e.vis]))
