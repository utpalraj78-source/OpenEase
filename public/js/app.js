// frontend js. server already validates everything, this is just to make forms nicer
// site still works with js turned off

(function () {
  // confirm dialogs on dangerous forms
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // registration countdown
  var cd = document.querySelector('.countdown[data-deadline]');
  if (cd) {
    var out = cd.querySelector('.js-countdown');
    var deadline = new Date(cd.getAttribute('data-deadline')).getTime();
    var tick = function () {
      var ms = deadline - Date.now();
      if (ms <= 0) { out.textContent = '(closed)'; return; }
      var d = Math.floor(ms / 86400000);
      var h = Math.floor((ms % 86400000) / 3600000);
      var m = Math.floor((ms % 3600000) / 60000);
      out.textContent = d > 0 ? d + ' day(s) ' + h + ' hr left' : h + ' hr ' + m + ' min left';
    };
    tick();
    setInterval(tick, 30000);
  }

  // create / edit event: dynamic session rows
  var table = document.getElementById('sessionsTable');
  if (table) {
    var tbody = table.querySelector('tbody');
    var totalCap = document.getElementById('totalCap');
    var capSum = document.getElementById('capSum');
    var capTotal = document.getElementById('capTotal');

    var recalc = function () {
      var sum = 0;
      tbody.querySelectorAll('.cap-input').forEach(function (i) { sum += parseInt(i.value, 10) || 0; });
      var total = parseInt(totalCap.value, 10) || 0;
      capSum.textContent = sum;
      capTotal.textContent = total;
      capSum.style.color = total && sum > total ? '#b42318' : '';
    };

    document.getElementById('addSession').addEventListener('click', function () {
      var first = tbody.querySelector('.session-row');
      var row = first.cloneNode(true);
      row.querySelectorAll('input').forEach(function (i) { i.value = ''; });
      row.querySelectorAll('select').forEach(function (s) { s.selectedIndex = 0; });
      // a cloned row with bookings text should become removable
      row.lastElementChild.innerHTML = '<button type="button" class="linkbtn js-remove-row">Remove</button>';
      tbody.appendChild(row);
      row.querySelector('input[name="sessions[sessionTitle][]"]').focus();
    });

    tbody.addEventListener('click', function (e) {
      if (!e.target.classList.contains('js-remove-row')) return;
      var rows = tbody.querySelectorAll('.session-row');
      var row = e.target.closest('tr');
      if (rows.length === 1) {
        row.querySelectorAll('input').forEach(function (i) { i.value = ''; });
        row.querySelectorAll('select').forEach(function (s) { s.selectedIndex = 0; });
      } else {
        row.remove();
      }
      recalc();
    });

    tbody.addEventListener('input', recalc);
    totalCap.addEventListener('input', recalc);
    recalc();

    // warn before leaving with unsaved edits
    var form = document.getElementById('eventForm');
    var dirty = false;
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
    document.querySelectorAll('.js-discard').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (dirty && !confirm('Discard unsaved changes?')) e.preventDefault();
      });
    });

    // 5 step wizard. all steps are one form, we just show one at a time
    var steps = Array.prototype.slice.call(form.querySelectorAll('.wizard-step'));
    var dots = Array.prototype.slice.call(document.querySelectorAll('#stepper li'));
    var prev = form.querySelector('.js-prev');
    var next = form.querySelector('.js-next');
    var submit = form.querySelector('.js-submit');
    var current = 1;

    var text = function (name) {
      var el = form.elements[name];
      if (!el) return '';
      if (el.tagName === 'SELECT') return el.value ? el.options[el.selectedIndex].text : '';
      return el.value;
    };
    var buildReview = function () {
      var rows = [
        ['Title', text('title')], ['Category', text('category')], ['Department', text('organizer')],
        ['Date', text('eventDate')], ['Time', text('startTime') && text('endTime') ? text('startTime') + ' - ' + text('endTime') : ''],
        ['Main venue', text('venue')], ['Total capacity', text('totalMaxCapacity')],
        ['Registration', text('registrationStart') && text('registrationEnd')
          ? text('registrationStart').replace('T', ' ') + ' to ' + text('registrationEnd').replace('T', ' ') : ''],
        ['Eligibility', text('criteriaId')]
      ];
      var box = document.getElementById('reviewBox');
      box.innerHTML = '';
      rows.forEach(function (r) {
        var dt = document.createElement('dt'); dt.textContent = r[0];
        var dd = document.createElement('dd'); dd.textContent = r[1] && r[1].trim() !== '-' ? r[1] : '(missing)';
        if (dd.textContent === '(missing)') dd.className = 'req';
        box.appendChild(dt); box.appendChild(dd);
      });
      var t = document.createElement('table');
      t.className = 'table';
      t.innerHTML = '<thead><tr><th>Session</th><th>Time</th><th>Room</th><th>Seats</th></tr></thead><tbody></tbody>';
      tbody.querySelectorAll('.session-row').forEach(function (r) {
        var title = r.querySelector('input[name="sessions[sessionTitle][]"]').value;
        if (!title) return;
        var sel = r.querySelector('select');
        var tr = document.createElement('tr');
        [title, r.querySelector('input[name="sessions[startTime][]"]').value + ' - ' + r.querySelector('input[name="sessions[endTime][]"]').value,
          sel.value ? sel.options[sel.selectedIndex].text : '', r.querySelector('.cap-input').value].forEach(function (v) {
          var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        });
        t.querySelector('tbody').appendChild(tr);
      });
      var holder = document.getElementById('reviewSessions');
      holder.innerHTML = '<h3>Sessions</h3>';
      holder.appendChild(t);
    };

    var show = function (n) {
      current = Math.max(1, Math.min(steps.length, n));
      steps.forEach(function (s) { s.classList.toggle('current', +s.dataset.step === current); });
      updateStepperState();
      prev.hidden = current === 1;
      next.hidden = current === steps.length;
      if (submit) submit.hidden = current !== steps.length;
      if (current === steps.length) buildReview();
      window.scrollTo(0, 0);
    };

    function clearErrors(stepEl) {
      if (!stepEl) return;
      stepEl.querySelectorAll('.field-invalid').forEach(function (el) {
        el.classList.remove('field-invalid');
      });
      var existingMsg = stepEl.querySelector('.step-validation-msg');
      if (existingMsg) existingMsg.remove();
    }

    function showStepError(stepEl, message, invalidEl) {
      clearErrors(stepEl);
      if (invalidEl) {
        invalidEl.classList.add('field-invalid');
        try { invalidEl.focus(); } catch (e) {}
      }
      var msgBox = document.createElement('div');
      msgBox.className = 'step-validation-msg';
      msgBox.innerHTML = '<strong>Required:</strong> ' + message;
      stepEl.insertBefore(msgBox, stepEl.firstChild);
    }

    function validateStep(n, silent) {
      var stepEl = form.querySelector('.wizard-step[data-step="' + n + '"]');
      if (!stepEl) return true;
      if (!silent) clearErrors(stepEl);

      var report = function (msg, el) {
        if (!silent) showStepError(stepEl, msg, el);
        return false;
      };

      if (n === 1) {
        var title = form.elements['title'];
        if (!title || !title.value.trim() || title.value.trim().length < 5) {
          return report('Event Title is required and must be at least 5 characters.', title);
        }
        var category = form.elements['category'];
        if (!category || !category.value) {
          return report('Please select an Event Category.', category);
        }
        var description = form.elements['description'];
        if (!description || !description.value.trim()) {
          return report('Event Description is required.', description);
        }
        var eventDate = form.elements['eventDate'];
        if (!eventDate || !eventDate.value) {
          return report('Please select an Event Date.', eventDate);
        }
        var d = new Date(eventDate.value + 'T00:00:00');
        var today = new Date(); today.setHours(0, 0, 0, 0);
        if (d < today) {
          return report('Event Date must be today or in the future.', eventDate);
        }
        var startTime = form.elements['startTime'];
        if (!startTime || !startTime.value) {
          return report('Start Time is required.', startTime);
        }
        var endTime = form.elements['endTime'];
        if (!endTime || !endTime.value) {
          return report('End Time is required.', endTime);
        }
        if (startTime.value >= endTime.value) {
          return report('Start time must precede end time.', endTime);
        }
        var organizer = form.elements['organizer'];
        if (!organizer || !organizer.value.trim()) {
          return report('Organizer / Department name is required.', organizer);
        }
      } else if (n === 2) {
        var venue = form.elements['venue'];
        if (!venue || !venue.value) {
          return report('Please select a Main Venue (reporting point).', venue);
        }
        var totalCap = form.elements['totalMaxCapacity'];
        var capVal = parseInt(totalCap ? totalCap.value : '', 10);
        if (!totalCap || !totalCap.value || isNaN(capVal) || capVal < 1) {
          return report('Total Max Capacity must be a whole number of at least 1.', totalCap);
        }
      } else if (n === 3) {
        var regStart = form.elements['registrationStart'];
        if (!regStart || !regStart.value) {
          return report('Registration Start Date & Time is required.', regStart);
        }
        var regEnd = form.elements['registrationEnd'];
        if (!regEnd || !regEnd.value) {
          return report('Registration End Date & Time is required.', regEnd);
        }
        if (new Date(regStart.value) >= new Date(regEnd.value)) {
          return report('Registration Start must be earlier than Registration End.', regEnd);
        }
        var evDateVal = form.elements['eventDate'] ? form.elements['eventDate'].value : '';
        if (evDateVal) {
          var evD = new Date(evDateVal + 'T23:59:59');
          if (new Date(regEnd.value) > evD) {
            return report('Registration must close on or before the event day.', regEnd);
          }
        }
        var criteria = form.elements['criteriaId'];
        if (!criteria || !criteria.value) {
          return report('Please pick an Eligibility Criteria option.', criteria);
        }
      } else if (n === 4) {
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('.session-row'));
        var validRows = 0;
        var totalAllocated = 0;
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          var titleInp = r.querySelector('input[name="sessions[sessionTitle][]"]');
          var sTimeInp = r.querySelector('input[name="sessions[startTime][]"]');
          var eTimeInp = r.querySelector('input[name="sessions[endTime][]"]');
          var vSel = r.querySelector('select[name="sessions[venue][]"]');
          var capInp = r.querySelector('.cap-input');

          var hasAny = (titleInp && titleInp.value.trim()) || (sTimeInp && sTimeInp.value) ||
                       (eTimeInp && eTimeInp.value) || (vSel && vSel.value) || (capInp && capInp.value);
          if (!hasAny) continue;

          if (!titleInp || !titleInp.value.trim()) {
            return report('Session title is required for row ' + (i + 1) + '.', titleInp);
          }
          if (!sTimeInp || !sTimeInp.value) {
            return report('Start time is required for session ' + (i + 1) + '.', sTimeInp);
          }
          if (!eTimeInp || !eTimeInp.value) {
            return report('End time is required for session ' + (i + 1) + '.', eTimeInp);
          }
          if (sTimeInp.value >= eTimeInp.value) {
            return report('Start time must precede end time for session ' + (i + 1) + '.', eTimeInp);
          }
          if (!vSel || !vSel.value) {
            return report('Venue/room is required for session ' + (i + 1) + '.', vSel);
          }
          var cVal = parseInt(capInp ? capInp.value : '', 10);
          if (!capInp || !capInp.value || isNaN(cVal) || cVal < 1) {
            return report('Allocated capacity must be at least 1 for session ' + (i + 1) + '.', capInp);
          }
          validRows++;
          totalAllocated += cVal;
        }
        if (validRows === 0) {
          return report('Add at least one configured breakout session before proceeding.', tbody.querySelector('input'));
        }
        var maxCap = parseInt(form.elements['totalMaxCapacity'] ? form.elements['totalMaxCapacity'].value : '', 10) || 0;
        if (maxCap > 0 && totalAllocated > maxCap) {
          return report('Total session seats (' + totalAllocated + ') exceed total event capacity (' + maxCap + ').', stepEl.querySelector('.cap-input'));
        }
      }
      return true;
    }

    function canAdvanceTo(target) {
      if (target <= current) return true;
      for (var s = 1; s < target; s++) {
        if (!validateStep(s, false)) {
          show(s);
          return false;
        }
      }
      return true;
    }

    var updateStepperState = function () {
      dots.forEach(function (d) {
        var k = +d.dataset.step;
        d.classList.toggle('current', k === current);
        d.classList.toggle('done', k < current && validateStep(k, true));
        var accessible = true;
        for (var s = 1; s < k; s++) {
          if (!validateStep(s, true)) { accessible = false; break; }
        }
        d.classList.toggle('locked', !accessible && k > current);
        var btn = d.querySelector('button');
        if (btn) {
          btn.setAttribute('aria-disabled', (!accessible && k > current) ? 'true' : 'false');
        }
      });
    };

    next.addEventListener('click', function () {
      if (validateStep(current, false)) {
        show(current + 1);
      }
    });

    prev.addEventListener('click', function () {
      show(current - 1);
    });

    document.querySelectorAll('.js-goto').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var target = +b.dataset.step;
        if (canAdvanceTo(target)) {
          show(target);
        }
      });
    });

    form.addEventListener('input', function (e) {
      if (e.target && e.target.classList.contains('field-invalid')) {
        e.target.classList.remove('field-invalid');
      }
      updateStepperState();
    });
    form.addEventListener('change', function (e) {
      if (e.target && e.target.classList.contains('field-invalid')) {
        e.target.classList.remove('field-invalid');
      }
      updateStepperState();
    });

    // after a server error open the step the first error belongs to
    var errBox = document.getElementById('formErrors');
    show(errBox ? +errBox.dataset.step : 1);
  }

  // register page: keep the summary box in sync
  var pick = document.getElementById('sessionPick');
  if (pick) {
    var sync = function () {
      var r = pick.querySelector('input[name=sessionId]:checked');
      pick.querySelectorAll('tbody tr').forEach(function (tr) { tr.classList.remove('is-picked'); });
      if (r) {
        r.closest('tr').classList.add('is-picked');
        document.getElementById('sumSession').textContent = r.dataset.title;
        document.getElementById('sumTime').textContent = r.dataset.time;
        document.getElementById('sumVenue').textContent = r.dataset.venue;
      }
      var vt = document.getElementById('visitorType');
      document.getElementById('sumVisitor').textContent = vt.options[vt.selectedIndex].text;
    };
    pick.addEventListener('change', sync);
    document.getElementById('visitorType').addEventListener('change', sync);
    // clicking anywhere on a row picks it
    pick.addEventListener('click', function (e) {
      var tr = e.target.closest('tbody tr');
      var radio = tr && tr.querySelector('input[type=radio]');
      if (radio && !radio.disabled && e.target !== radio) { radio.checked = true; sync(); }
    });
    sync();
  }

  // attendance terminal
  var roster = document.getElementById('roster');
  if (roster) {
    var labels = { PRESENT: 'Present', ABSENT: 'Absent', PENDING: 'Not marked' };
    var rows = Array.prototype.slice.call(roster.querySelectorAll('tbody tr'));
    var note = document.getElementById('dirtyNote');
    var changed = 0;
    var PER_PAGE = 10;
    var page = 1;

    var counters = function () {
      var c = { PRESENT: 0, ABSENT: 0, PENDING: 0 };
      rows.forEach(function (r) { c[r.dataset.status]++; });
      document.getElementById('mPresent').textContent = c.PRESENT;
      document.getElementById('mAbsent').textContent = c.ABSENT;
      document.getElementById('mPending').textContent = c.PENDING;
      changed = roster.querySelectorAll('tr.changed').length;
      note.textContent = changed ? changed + ' unsaved change(s)' : '';
    };

    var setStatus = function (row, status) {
      var original = row.dataset.original || row.dataset.status;
      row.dataset.original = original;
      row.dataset.status = status;
      row.querySelector('.js-status').value = status;
      var badge = row.querySelector('.js-badge');
      badge.className = 'badge js-badge badge-' + status.toLowerCase();
      badge.textContent = labels[status];
      row.querySelectorAll('.toggle button').forEach(function (b) {
        b.classList.toggle('on', b.dataset.set === status);
      });
      row.classList.toggle('changed', status !== original);
    };

    roster.addEventListener('click', function (e) {
      var btn = e.target.closest('.toggle button');
      if (!btn) return;
      setStatus(btn.closest('tr'), btn.dataset.set);
      counters();
    });

    // select all / reset (reset = back to not marked, for the ticked rows or everyone)
    var checks = function () { return roster.querySelectorAll('.js-row-check'); };
    var checkAll = document.getElementById('checkAll');
    document.getElementById('selectAll').addEventListener('click', function () {
      var all = Array.prototype.every.call(checks(), function (c) { return c.checked; });
      checks().forEach(function (c) { c.checked = !all; });
      checkAll.checked = !all;
    });
    checkAll.addEventListener('change', function () {
      checks().forEach(function (c) { c.checked = checkAll.checked; });
    });
    document.getElementById('resetSel').addEventListener('click', function () {
      var ticked = rows.filter(function (r) { return r.querySelector('.js-row-check').checked; });
      (ticked.length ? ticked : rows).forEach(function (r) { setStatus(r, 'PENDING'); });
      counters();
    });

    // search + pages (10 rows per page)
    var search = document.getElementById('rosterSearch');
    var render = function () {
      var q = search.value.trim().toLowerCase();
      var hits = rows.filter(function (r) { return !q || r.dataset.search.indexOf(q) !== -1; });
      var pages = Math.max(1, Math.ceil(hits.length / PER_PAGE));
      if (page > pages) page = pages;
      rows.forEach(function (r) { r.style.display = 'none'; });
      hits.slice((page - 1) * PER_PAGE, page * PER_PAGE).forEach(function (r) { r.style.display = ''; });
      var from = hits.length ? (page - 1) * PER_PAGE + 1 : 0;
      document.getElementById('pageInfo').textContent =
        'Showing ' + from + '-' + Math.min(page * PER_PAGE, hits.length) + ' of ' + hits.length + ' visitors';
      var box = document.getElementById('pages');
      box.innerHTML = '';
      var mk = function (label, n, disabled, on) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = label; b.disabled = disabled;
        if (on) b.className = 'on';
        b.addEventListener('click', function () { page = n; render(); });
        box.appendChild(b);
      };
      mk('Previous', page - 1, page === 1);
      for (var i = 1; i <= pages; i++) mk(String(i), i, false, i === page);
      mk('Next', page + 1, page === pages);
    };
    search.addEventListener('input', function () { page = 1; render(); });

    window.addEventListener('beforeunload', function (e) {
      if (changed) { e.preventDefault(); e.returnValue = ''; }
    });
    document.getElementById('attendanceForm').addEventListener('submit', function () { changed = 0; });

    counters();
    render();
  }
})();


// mobile menu + stacked tables (responsive)
(function () {
  var bar = document.getElementById('topbar');
  var btn = bar && bar.querySelector('.menu-toggle');
  if (btn) {
    btn.addEventListener('click', function () {
      var open = bar.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
  }

  // put the th text on each td as data-label so the css can show it on phones
  function labelTable(table) {
    var heads = Array.prototype.map.call(table.querySelectorAll('thead th'), function (th) {
      return th.textContent.replace(/\s+/g, ' ').trim();
    });
    if (!heads.length) return;
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (!td.hasAttribute('data-label') && heads[i]) td.setAttribute('data-label', heads[i]);
        // wrap content so it stays in one column next to the label
        if (!(td.children.length === 1 && td.firstElementChild.classList.contains('td-v') && td.childNodes.length === 1)) {
          var box = document.createElement('div');
          box.className = 'td-v';
          while (td.firstChild) box.appendChild(td.firstChild);
          td.appendChild(box);
        }
      });
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('table.table'), function (t) {
    labelTable(t);
    var body = t.querySelector('tbody');
    if (body && window.MutationObserver) {
      new MutationObserver(function () { labelTable(t); }).observe(body, { childList: true });
    }
  });
})();
