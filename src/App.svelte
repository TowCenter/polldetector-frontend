<script>
  import { onMount } from 'svelte';
  // Force cache bust for production testing - timestamp: 2024-10-14-20:25
  let data = [];
  let filteredData = [];
  let loading = true;
  let error = null;
  console.log('Cache bust test:', new Date().toISOString());
  

  const today = new Date();
  // Use local date for the date picker
  const todayStr = today.getFullYear() + '-' +
                   String(today.getMonth() + 1).padStart(2, '0') + '-' +
                   String(today.getDate()).padStart(2, '0');

  // Filters
  let dateFilter = todayStr;
  let collectionFilter = '';
  let uniqueCollections = [];

  // Sorting
  let sortColumn = 'added_on';
  let sortDirection = 'desc';

  // View mode
  let viewMode = 'grouped'; // 'table' or 'grouped'
  let groupedData = {};
  let collapsedGroups = {}; // key: pollId, value: boolean

  // Grouped view sorting
  let groupSortColumn = 'added_on';
  let groupSortDirection = 'desc';

  function toggleGroup(pollId) {
    collapsedGroups[pollId] = !collapsedGroups[pollId];
    collapsedGroups = { ...collapsedGroups };
  }

  // Feedback tracking
  let feedback = {}; // key: url+match_poll_id, value: 'correct' or 'incorrect'

  // Track first-seen dates for temp_poll_ids
  let tempPollFirstSeen = {};

  async function fetchData() {
    // Use environment variable for production API base, fallback to Railway production URL
    const PROD_API_BASE = import.meta.env.VITE_API_BASE || 'https://pollfinder-production.up.railway.app';
    
    // Use local API only in development mode
    const isDev = import.meta.env.DEV;
    const apiUrl = isDev
      ? 'http://localhost:3001/api/polls'
      : `${PROD_API_BASE}/api/polls`;
    loading = true;
    error = null;

    try {
      // Query both today and tomorrow in UTC to ensure we get all local day's data
      // (since local day can span two UTC days)
      const [year, month, day] = (dateFilter || todayStr).split('-').map(Number);
      const localDate = new Date(year, month - 1, day);
      
      // Get the UTC dates that could contain this local date
      const utcDate = localDate.getUTCFullYear() + '-' +
                      String(localDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
                      String(localDate.getUTCDate()).padStart(2, '0');
      
      // Also query the next UTC day to catch evening local times
      const nextDay = new Date(localDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const nextUtcDate = nextDay.getUTCFullYear() + '-' +
                          String(nextDay.getUTCMonth() + 1).padStart(2, '0') + '-' +
                          String(nextDay.getUTCDate()).padStart(2, '0');
      
      // Fetch both days and combine
      const [response1, response2] = await Promise.all([
        fetch(`${apiUrl}?date=${utcDate}`),
        fetch(`${apiUrl}?date=${nextUtcDate}`)
      ]);
      
      if (!response1.ok) throw new Error(`HTTP ${response1.status}`);
      if (!response2.ok) throw new Error(`HTTP ${response2.status}`);
      
      const [data1, data2] = await Promise.all([
        response1.json(),
        response2.json()
      ]);
      
      const parsed = [...(Array.isArray(data1) ? data1 : []), ...(Array.isArray(data2) ? data2 : [])];
      
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const columns = Object.keys(parsed);
        const firstColumn = parsed[columns[0]];
        const numRows = Object.keys(firstColumn).length;
        data = [];
        for (let i = 0; i < numRows; i++) {
          const row = {};
          columns.forEach(col => (row[col] = parsed[col][i]));
          data.push(row);
        }
      } else if (Array.isArray(parsed)) {
        data = parsed;
      }

      console.log('📊 Data before filtering:', data.length, 'items');

      // Remove rows whose extracted poll has no pollster or pollster is 'N/A'
      data = data.filter(item => {
        const pollsArray = Array.isArray(item.polls) ? item.polls : (item.polls ? [item.polls] : []);
        const firstPoll = coercePoll(pollsArray[0]);
        const hasValidPollster = firstPoll && firstPoll.pollster && firstPoll.pollster !== 'N/A';
        return hasValidPollster;
      });

      if (data.length > 0) {
        const collectionsSet = new Map();
        data.forEach(item => {
          extractCollections(item.collections).forEach(label => {
            const key = label.toLowerCase();
            if (!collectionsSet.has(key)) collectionsSet.set(key, label);
          });
        });
        uniqueCollections = Array.from(collectionsSet.values()).sort((a, b) => a.localeCompare(b));

        let allColumns = Object.keys(data[0]).filter(f => f !== 'id' && f !== 'num_polls_found' && f !== 'polls_mentioned' && f !== 'collections' && f !== 'feedback' && f !== 'notes');
        const urlIndex = allColumns.indexOf('url');
        const addedOnIndex = allColumns.indexOf('added_on');
        if (urlIndex !== -1 && addedOnIndex !== -1) {
          [allColumns[urlIndex], allColumns[addedOnIndex]] = [allColumns[addedOnIndex], allColumns[urlIndex]];
        }
        // Add feedback and notes columns at the end
        allColumns.push('feedback');
        allColumns.push('notes');
        columnOrder = allColumns;

        filteredData = [...data];
        applyFilters();
        sortData('added_on', false);

        // Fetch first-seen dates for temp_poll_ids
        const tempIds = [...new Set(data.filter(d => d.temp_poll_id && !d.match_poll_id).map(d => d.temp_poll_id))];
        if (tempIds.length > 0) {
          const apiBase = isDev ? 'http://localhost:3001' : PROD_API_BASE;
          try {
            const fsResp = await fetch(`${apiBase}/api/temp-poll-first-seen?ids=${tempIds.join(',')}`);
            if (fsResp.ok) {
              tempPollFirstSeen = await fsResp.json();
            }
          } catch (e) {
            console.warn('Could not fetch temp poll first-seen dates:', e);
          }
        }
      }
    } catch (err) {
      error = err.message;
      console.error('Fetch error:', err);
    } finally {
      loading = false;
    }
  }

  // Reactive logging to debug rendering
  $: console.log('🎯 Reactive update - data.length:', data.length, 'filteredData.length:', filteredData.length, 'viewMode:', viewMode);

  // Define column order (collections at the end)
  let columnOrder = [];

  function normalizeCollectionLabel(c) {
    if (c == null) return '';
    return c.toString()
      .replace(/^[\s'"\[\]]+|[\s'"\[\]]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractCollections(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(normalizeCollectionLabel).filter(Boolean);

    if (typeof val === 'string') {
      const s = val.trim();
      if (s.startsWith('[') && s.endsWith(']')) {
        try {
          const arr = JSON.parse(s);
          if (Array.isArray(arr)) return arr.map(normalizeCollectionLabel).filter(Boolean);
        } catch {}
      }
      const pieces = s.includes(',') || s.includes('|') ? s.split(/[,\|]+/) : [s];
      return pieces.map(normalizeCollectionLabel).filter(Boolean);
    }
    return [];
  }

  function coercePoll(p) {
    // Accept objects, arrays-with-one-object, or JSON strings
    if (!p) return null;
    let obj = p;
    if (typeof p === 'string') {
      try { obj = JSON.parse(p); } catch { return null; }
    }
    if (Array.isArray(obj)) obj = obj[0] ?? null;
    if (obj && typeof obj === 'object') return obj;
    return null;
  }

  function getSample(p) {
    return p?.sample_size ?? p?.sample ?? 'N/A';
  }

  function isValidUrl(urlString) {
    if (!urlString) return false;
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function formatPollDate(poll) {
    if (!poll) return 'N/A';
    
    const startDate = poll.start_date || poll.date;
    const endDate = poll.end_date;
    
    if (!startDate) return 'N/A';
    
    if (endDate && endDate !== startDate) {
      return `${startDate} to ${endDate}`;
    } else {
      return startDate;
    }
  }

  async function handleFeedback(item, feedbackType) {
    console.log('Handling feedback:', { id: item.id, feedbackType, item });
    try {
      // Use environment variable for production API base
      const PROD_API_BASE = import.meta.env.VITE_API_BASE || 'https://pollfinder-production.up.railway.app';
      
      // Use Railway API in production, local API in development
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const baseApiUrl = isLocalhost
        ? 'http://localhost:3001/api/polls'
        : window.location.hostname.includes('192.168') || window.location.hostname.includes('127.0')
          ? `http://${window.location.hostname}:3001/api/polls`
          : `${PROD_API_BASE}/api/polls`;
      const feedbackApiUrl = baseApiUrl.replace('/polls', '/feedback');
      
      console.log('Sending feedback to:', feedbackApiUrl);
      
      const response = await fetch(feedbackApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: item.id,
          feedback: feedbackType
        })
      });

      console.log('Response status:', response.status);
      
      if (response.ok) {
        console.log('Feedback saved successfully');
        // Update local state to show the feedback immediately
        item.feedback = feedbackType;
        data = [...data]; // trigger reactivity
        filteredData = [...filteredData]; // also update filtered data
      } else {
        const errorText = await response.text();
        console.error('Failed to save feedback:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error saving feedback:', error);
    }
  }

  async function handleNotes(item, notesText) {
    console.log('Handling notes:', { id: item.id, notesText, item });
    try {
      // Use environment variable for production API base
      const PROD_API_BASE = import.meta.env.VITE_API_BASE || 'https://pollfinder-production.up.railway.app';
      
      // Use Railway API in production, local API in development
      const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const baseApiUrl = isLocalhost
        ? 'http://localhost:3001/api/polls'
        : window.location.hostname.includes('192.168') || window.location.hostname.includes('127.0')
          ? `http://${window.location.hostname}:3001/api/polls`
          : `${PROD_API_BASE}/api/polls`;
      const notesApiUrl = baseApiUrl.replace('/polls', '/notes');
      
      console.log('Sending notes to:', notesApiUrl);
      
      const response = await fetch(notesApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: item.id,
          notes: notesText
        })
      });

      console.log('Response status:', response.status);
      
      if (response.ok) {
        console.log('Notes saved successfully');
        // Update local state to show the notes immediately
        item.notes = notesText;
        data = [...data]; // trigger reactivity
        filteredData = [...filteredData]; // also update filtered data
      } else {
        const errorText = await response.text();
        console.error('Failed to save notes:', response.status, errorText);
      }
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  function getFeedbackKey(item) {
    return `${item.url}_${item.match_poll_id || 'no_match'}`;
  }

  function downloadFeedbackCSV() {
    const rows = [];
    rows.push(['URL', 'Added On', 'ID', 'Match Poll ID', 'Added On', 'Pollster', 'Sponsor', 'Feedback']);
    
    filteredData.forEach(item => {
      const key = getFeedbackKey(item);
      if (feedback[key]) {
        let confidence = 'N/A';
        let pollster = 'N/A';
        let sponsor = 'N/A';
        
        if (item.match_results) {
          const matchData = typeof item.match_results === 'string' ? JSON.parse(item.match_results) : item.match_results;
          confidence = matchData?.matches?.[0]?.confidence || 'N/A';
          pollster = matchData?.matches?.[0]?.matched_poll?.pollster || 'N/A';
          sponsor = matchData?.matches?.[0]?.matched_poll?.sponsor || 'N/A';
        }
        
        rows.push([
          item.url,
          item.added_on,
          item.id,
          item.match_poll_id || 'No Match',
          item.added_on,
          pollster,
          sponsor,
          feedback[key]
        ]);
      }
    });

    const csvContent = rows.map(row => 
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `poll_feedback_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function applyFilters() {
    console.log('🔍 applyFilters called - data.length:', data.length, 'dateFilter:', dateFilter, 'collectionFilter:', collectionFilter);
    filteredData = data.filter(item => {
      // Filter by date using local time conversion
      if (dateFilter && item.added_on) {
        const d = new Date(item.added_on);
        // Convert UTC timestamp to local date
        const itemDateStr = d.getFullYear() + '-' +
                            String(d.getMonth() + 1).padStart(2, '0') + '-' +
                            String(d.getDate()).padStart(2, '0');
        if (itemDateStr !== dateFilter) {
          return false;
        }
      }
      if (collectionFilter) {
        const labels = extractCollections(item.collections).map(s => s.toLowerCase());
        if (!labels.includes(collectionFilter.toLowerCase())) return false;
      }
      return true;
    });

    console.log('🔍 After applyFilters - filteredData.length:', filteredData.length);
    if (filteredData.length > 0) {
      console.log('✅ Polls that passed date filter:', filteredData.map(p => ({ id: p.id, added_on: p.added_on })));
    }

    if (sortColumn) sortData(sortColumn, false);
    
    // Update grouped data
    groupDataByPollId();
  }

  function groupDataByPollId() {
    groupedData = {};
    filteredData.forEach(item => {
      // Use match_poll_id if available, otherwise fall back to temp_poll_id, otherwise 'No Match'
      const pollId = item.match_poll_id || item.temp_poll_id || 'No Match';
      if (!groupedData[pollId]) {
        groupedData[pollId] = [];
      }
      groupedData[pollId].push(item);
    });
    
    // Sort items within each group
    Object.keys(groupedData).forEach(pollId => {
      groupedData[pollId] = sortGroupItems(groupedData[pollId]);
    });

    // Get sorted keys in the same order as the display
    const sortedKeys = Object.entries(groupedData).sort(([a, itemsA], [b, itemsB]) => {
      const aIsNoMatch = a === 'No Match';
      const bIsNoMatch = b === 'No Match';
      if (aIsNoMatch !== bIsNoMatch) return aIsNoMatch ? 1 : -1;
      const countDiff = itemsB.length - itemsA.length;
      if (countDiff !== 0) return countDiff;
      return a.localeCompare(b);
    }).map(([key]) => key);
    
    // Collapse all groups except the first one
    collapsedGroups = {};
    sortedKeys.forEach((key, index) => {
      collapsedGroups[key] = index !== 0 && key !== 'No Match'; // Collapse all except first and 'No Match'
    });
  }

  function sortGroupItems(items) {
    return [...items].sort((a, b) => {
      let aVal, bVal;
      
      if (groupSortColumn === 'added_on') {
        aVal = new Date(a.added_on);
        bVal = new Date(b.added_on);
      } else if (groupSortColumn === 'url') {
        aVal = a.url;
        bVal = b.url;
      } else if (groupSortColumn === 'pollster' || groupSortColumn === 'sponsor') {
        // Get pollster/sponsor from polls array for table display
        const pollsA = Array.isArray(a.polls) ? a.polls : [a.polls];
        const pollsB = Array.isArray(b.polls) ? b.polls : [b.polls];
        const pollA = pollsA[0] ? (typeof pollsA[0] === 'string' ? JSON.parse(pollsA[0]) : pollsA[0]) : {};
        const pollB = pollsB[0] ? (typeof pollsB[0] === 'string' ? JSON.parse(pollsB[0]) : pollsB[0]) : {};
        aVal = pollA[groupSortColumn] || '';
        bVal = pollB[groupSortColumn] || '';
      } else if (groupSortColumn === 'confidence') {
        const matchDataA = typeof a.match_results === 'string' ? JSON.parse(a.match_results) : a.match_results;
        const matchDataB = typeof b.match_results === 'string' ? JSON.parse(b.match_results) : b.match_results;
        aVal = matchDataA?.matches?.[0]?.confidence || 0;
        bVal = matchDataB?.matches?.[0]?.confidence || 0;
      } else {
        aVal = a[groupSortColumn];
        bVal = b[groupSortColumn];
      }
      
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (aVal < bVal) return groupSortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return groupSortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function sortGroupedData(column) {
    if (groupSortColumn === column) {
      groupSortDirection = groupSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      groupSortColumn = column;
      groupSortDirection = 'asc';
    }
    
    // Re-sort all groups
    Object.keys(groupedData).forEach(pollId => {
      groupedData[pollId] = sortGroupItems(groupedData[pollId]);
    });
    
    // Trigger reactivity
    groupedData = { ...groupedData };
  }

  function sortData(column, toggleDirection = true) {
    if (toggleDirection) {
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = 'asc';
      }
    }
    filteredData = [...filteredData].sort((a, b) => {
      let aVal = a[column];
      let bVal = b[column];
      if (column === 'added_on') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  onMount(fetchData);
</script>

<!-- ====== HEADER ====== -->
<header class="site-header">
  <div class="site-header__inner container">
    <a class="brand" href="/" aria-label="Pollfinder home">
      <!-- Simple, bold wordmark + glyph -->
      <svg class="brand__glyph" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle>
        <line x1="16.5" y1="16.5" x2="22" y2="22"></line>
      </svg>
      <span class="brand__name">Pollfinder</span>
    </a>

    <nav class="top-nav" aria-label="Primary">
      <a href="#data">Data</a>
      <a href="#about">About</a>
      <a href="#methods">Methods</a>
    </nav>
  </div>
</header>

<!-- ====== INTRO / HERO ====== -->
<article class="container">
  <div class="hero">
    <div class="hero__copy">
      <h1>Poll Detector</h1>
      <p class="dek">Detect poll mentions in the wild using large language models, then structure the results for analysis.</p>

      <div class="filters">
        <div class="field">
          <label for="date">Date</label>
          <input id="date" type="date" bind:value={dateFilter} on:change={fetchData} />
          {#if dateFilter}
            <button class="btn ghost" on:click={() => { dateFilter = ''; fetchData(); }}>Clear</button>
          {/if}
        </div>

        <div class="field">
          <label for="collection">Collection</label>
          <select id="collection" bind:value={collectionFilter} on:change={applyFilters}>
            <option value="">All collections</option>
            {#each uniqueCollections as collection}
              <option value={collection}>{collection}</option>
            {/each}
          </select>
        </div>

        {#if Object.keys(feedback).length > 0}
          <div class="field">
            <button class="btn" on:click={downloadFeedbackCSV}>
              Download Feedback CSV ({Object.keys(feedback).length})
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</article>

<!-- ====== VIEW TOGGLE ====== -->
<div class="container">
  <div class="view-toggle">
    <button 
      class="view-btn" 
      class:active={viewMode === 'table'}
      on:click={() => viewMode = 'table'}
    >
      <svg class="view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
      Table View
    </button>
    <button 
      class="view-btn" 
      class:active={viewMode === 'grouped'}
      on:click={() => viewMode = 'grouped'}
    >
      <svg class="view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="4"></rect>
        <rect x="3" y="9" width="18" height="4"></rect>
        <rect x="3" y="15" width="18" height="4"></rect>
      </svg>
      Grouped by Match ID
    </button>
  </div>
</div>

<!-- ====== DATA TABLE ====== -->
<main id="data" class="container">
  {#if loading}
    <div class="notice">Loading data…</div>
  {:else if error}
    <div class="notice error">
      <strong>Error:</strong> {error}
    </div>
  {:else if data.length > 0}
    {#if viewMode === 'table'}
      <div class="card table-card">
        <div class="table-scroll">
          <table class="data-table">
          <thead>
            <tr>
              {#each columnOrder as field}
                <th class:sortable={field !== 'feedback' && field !== 'notes'} on:click={() => field !== 'feedback' && field !== 'notes' && sortData(field)}>
                  {#if field === 'polls'}
                    🤖 Extracted Polls
                  {:else if field === 'match_results'}
                    Matched Poll
                  {:else if field === 'match_poll_id'}
                    Matched Poll ID
                  {:else if field === 'feedback'}
                    Feedback
                  {:else if field === 'notes'}
                    Notes
                  {:else}
                    {field}
                  {/if}
                  {#if sortColumn === field && field !== 'feedback' && field !== 'notes'}
                    <span class="sort">{sortDirection === 'asc' ? '▲' : '▼'}</span>
                  {/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each filteredData as item}
              <tr>
                {#each columnOrder as field}
                  <td>
                    {#if field === 'url' && item[field]}
                      {@const url = new URL(item[field])}
                      {@const domain = url.hostname.replace('www.', '')}
                      {@const path = url.pathname + url.search}
                      <a class="url-link" href={item[field]} target="_blank" rel="noopener noreferrer" title={item[field]}>
                        <span class="url-domain">{domain}</span>
                        <span class="url-path">{path.length > 40 ? path.substring(0, 40) + '…' : path}</span>
                      </a>
                    {:else if field === 'added_on' && item[field]}
                      {@const dateObj = new Date(item[field])}
                      {@const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {@const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}


                      <div class="datetime">
                        <div class="date">{dateStr}</div>
                        <div class="time">{timeStr}</div>
                      </div>
                    {:else if field === 'match_poll_id' && item[field]}
                      <!-- <div class="poll-id-badge"> -->
                        <span class="badge-value">{item[field]}</span>
                      <!-- </div> -->
                    {:else if field === 'match_results' && !item[field]}

                      <div style="margin-top:6px;">
                        {#if item.temp_poll_id && tempPollFirstSeen[item.temp_poll_id]}
                          {@const firstDate = new Date(tempPollFirstSeen[item.temp_poll_id])}
                          <span class="badge-potential">First seen {firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        {:else}
                          <span class="badge-potential">New Poll?</span>
                        {/if}
                      </div>
                      <span class="muted">No match found</span>
                    {:else if field === 'match_results' && item[field]}
                      {#if typeof item[field] === 'string'}
                        {@const parsed = JSON.parse(item[field])}
                        {#if parsed.matches && parsed.matches.length > 0 && parsed.matches[0].matched_poll}
                          {@const matchedPoll = parsed.matches[0].matched_poll}
                          {@const {poll_id, ...pollWithoutId} = matchedPoll}
                          <div class="match-card">
                            <div class="match-field">
                              <span class="field-label">Pollster:</span>
                              <span class="field-value">{pollWithoutId.pollster || 'N/A'}</span>
                            </div>
                            <div class="match-field">
                              <span class="field-label">Sponsor:</span>
                              <span class="field-value">{pollWithoutId.sponsor || 'N/A'}</span>
                            </div>
                            <div class="match-field">
                              <span class="field-label">Date:</span>
                              <span class="field-value">{formatPollDate(pollWithoutId)}</span>
                            </div>
                            <div class="match-field">
                              <span class="field-label">Location:</span>
                              <span class="field-value">{pollWithoutId.location || 'N/A'}</span>
                            </div>
                            <div class="match-field">
                              <span class="field-label">Sample:</span>
                              <span class="field-value">{pollWithoutId.sample_size || 'N/A'}</span>
                            </div>
                          </div>
                        {:else}
                          <!-- Show first-seen date or 'Potentially New Poll' badge when no matched poll exists -->
                          <div style="margin-top:6px;">
                            {#if item.temp_poll_id && tempPollFirstSeen[item.temp_poll_id]}
                              {@const firstDate = new Date(tempPollFirstSeen[item.temp_poll_id])}
                              <span class="badge-potential">First seen {firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            {:else}
                              <span class="badge-potential">Potentially New Poll</span>
                            {/if}
                          </div>
                                                    <span class="muted">No match found</span>

                        {/if}
                      {:else if item[field].matches && item[field].matches.length > 0 && item[field].matches[0].matched_poll}
                        {@const matchedPoll = item[field].matches[0].matched_poll}
                        {@const {poll_id, ...pollWithoutId} = matchedPoll}
                        <div class="match-card">
                          <div class="match-field">
                            <span class="field-label">Pollster:</span>
                            <span class="field-value">{pollWithoutId.pollster || 'N/A'}</span>
                          </div>
                          <div class="match-field">
                            <span class="field-label">Sponsor:</span>
                            <span class="field-value">{pollWithoutId.sponsor || 'N/A'}</span>
                          </div>
                          <div class="match-field">
                            <span class="field-label">Date:</span>
                            <span class="field-value">{formatPollDate(pollWithoutId)}</span>
                          </div>
                          <div class="match-field">
                            <span class="field-label">Location:</span>
                            <span class="field-value">{pollWithoutId.location || 'N/A'}</span>
                          </div>
                          <div class="match-field">
                            <span class="field-label">Sample:</span>
                            <span class="field-value">{pollWithoutId.sample_size || 'N/A'}</span>
                          </div>
                        </div>
                      {:else}
                        <span class="muted">No match found</span>
                      {/if}
                    {:else if field === 'polls' && item[field]}
                      {@const pollsArray = Array.isArray(item[field]) ? item[field] : [item[field]]}
                      {#if pollsArray.length > 0}
                        {#each pollsArray.slice(0, 3) as rawPoll, idx}
                          {@const poll = coercePoll(rawPoll)}
                          {#if poll}
                            <div class="match-card" style="margin-bottom: 8px;">
                              <div class="match-field">
                                <span class="field-label">Pollster:</span>
                                <span class="field-value">{poll.pollster || 'N/A'}</span>
                              </div>
                              <div class="match-field">
                                <span class="field-label">Sponsor:</span>
                                <span class="field-value">{poll.sponsor || 'N/A'}</span>
                              </div>
                              <div class="match-field">
                                <span class="field-label">Date:</span>
                                <span class="field-value">{formatPollDate(poll)}</span>
                              </div>
                              <div class="match-field">
                                <span class="field-label">Location:</span>
                                <span class="field-value">{poll.location || 'N/A'}</span>
                              </div>
                              <div class="match-field">
                                <span class="field-label">Sample:</span>
                                <span class="field-value">{getSample(poll)}</span>
                              </div>

                              {#if poll.poll_url && isValidUrl(poll.poll_url)}
                                <div class="match-field">
                                  <span class="field-label">Link:</span>
                                  <span class="field-value">
                                    <a href={poll.poll_url} target="_blank" rel="noopener noreferrer">Source</a>
                                  </span>
                                </div>
                              {/if}
                            </div>
                          {:else}
                            <!-- Fallback if we can't parse the entry -->
                            <div class="match-field" style="margin-bottom: 8px;">
                              <span class="field-label">Poll {idx + 1}:</span>
                              <span class="field-value">{typeof rawPoll === 'string' ? rawPoll : JSON.stringify(rawPoll)}</span>
                            </div>
                          {/if}
                        {/each}

                        {#if pollsArray.length > 3}
                          <div class="poll-more">+{pollsArray.length - 3} more poll{pollsArray.length - 3 > 1 ? 's' : ''}</div>
                        {/if}
                      {:else}
                        <span class="muted">No poll info</span>
                      {/if}
                    {:else if field === 'feedback'}
                      {@const feedbackKey = getFeedbackKey(item)}
                      <div class="feedback-buttons">
                        <button 
                          class="btn-feedback" 
                          class:selected={item.feedback === 'correct'}
                          on:click={() => handleFeedback(item, 'correct')}
                        >
                          ✓ Correct
                        </button>
                        <button 
                          class="btn-feedback" 
                          class:selected={item.feedback === 'incorrect'}
                          on:click={() => handleFeedback(item, 'incorrect')}
                        >
                          ✗ Incorrect
                        </button>
                        <button 
                          class="btn-feedback btn-not-interested" 
                          class:selected={item.feedback === 'not_interested'}
                          on:click={() => handleFeedback(item, 'not_interested')}
                        >
                          ⊘ Not Interested
                        </button>
                      </div>
                    {:else if field === 'notes'}
                      <div class="notes-container">
                        <textarea 
                          class="notes-input" 
                          placeholder="Add notes..."
                          value={item.notes || ''}
                          on:blur={(e) => handleNotes(item, e.target.value)}
                          rows="3"
                        ></textarea>
                      </div>
                    {:else if typeof item[field] === 'object' && item[field] !== null}
                      <pre class="json">{JSON.stringify(item[field], null, 2)}</pre>
                    {:else}
                      {item[field] || ''}
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    {:else}
      <!-- Grouped View -->
      <div class="grouped-view">
        {#each Object.entries(groupedData).sort(([a, itemsA], [b, itemsB]) => {
          // Sort special groups to the end: not_enough_information last, No Match second-to-last
          const aIsNEI = a === 'not_enough_information';
          const bIsNEI = b === 'not_enough_information';
          if (aIsNEI !== bIsNEI) return aIsNEI ? 1 : -1;

          const aIsNoMatch = a === 'No Match';
          const bIsNoMatch = b === 'No Match';
          if (aIsNoMatch !== bIsNoMatch) return aIsNoMatch ? 1 : -1;

          // Then sort by number of articles (descending)
          const countDiff = itemsB.length - itemsA.length;
          if (countDiff !== 0) return countDiff;

          // Finally sort by poll ID
          return a.localeCompare(b);
        }) as [pollId, items]}
          <div class="group-card">
            <div class="group-header-row" on:click={() => toggleGroup(pollId)} role="button" tabindex="0">
              <button class="collapse-btn" aria-label={collapsedGroups[pollId] ? 'Expand' : 'Collapse'}>
                {collapsedGroups[pollId] ? '▶' : '▼'}
              </button>
              <div class="header-content">
                {#if pollId !== 'No Match' && pollId !== 'not_enough_information'}
                  {@const firstItem = items[0]}
                  {@const matchData = typeof firstItem.match_results === 'string' ? JSON.parse(firstItem.match_results) : firstItem.match_results}
                  {@const isTempPoll = !firstItem.match_poll_id && firstItem.temp_poll_id}
                  {@const tempPollData = isTempPoll ? coercePoll((Array.isArray(firstItem.polls) ? firstItem.polls : [firstItem.polls])[0]) : null}
                  {@const pollster = isTempPoll ? (tempPollData?.pollster || 'N/A') : (matchData?.matches?.[0]?.matched_poll?.pollster || 'N/A')}
                  {@const sponsor = isTempPoll ? (tempPollData?.sponsor || 'N/A') : (matchData?.matches?.[0]?.matched_poll?.sponsor || 'N/A')}
                  {@const startDate = isTempPoll ? (tempPollData?.start_date || tempPollData?.date || 'N/A') : (matchData?.matches?.[0]?.matched_poll?.start_date || matchData?.matches?.[0]?.matched_poll?.date || 'N/A')}
                  {@const endDate = isTempPoll ? (tempPollData?.end_date || 'N/A') : (matchData?.matches?.[0]?.matched_poll?.end_date || 'N/A')}
                  {@const fmtDate = (d) => { if (!d || d === 'N/A') return 'N/A'; return /^\d{4}-\d{2}/.test(d) ? d.slice(5) : d; }}
                  {@const dateStr = endDate !== 'N/A' && endDate !== startDate ? `${fmtDate(startDate)} to ${fmtDate(endDate)}` : fmtDate(startDate)}
                  {@const sampleSize = isTempPoll ? (tempPollData?.sample_size || tempPollData?.sample || 'N/A') : (matchData?.matches?.[0]?.matched_poll?.sample_size || matchData?.matches?.[0]?.matched_poll?.sample || 'N/A')}

                  {#if isTempPoll}
                    <span class="poll-id-label">Temp Poll ID:</span>
                  {:else}
                    <span class="poll-id-label">Poll ID:</span>
                  {/if}
                  <span class="poll-id-value">{pollId}</span>
                  <span class="pollster-separator">•</span>

                  <span class="pollster-value">{pollster}</span>
                  <span class="pollster-separator">•</span>

                  {#if sponsor !== 'N/A'}
                    <span class="pollster-value">{sponsor}</span>
                    <span class="pollster-separator">•</span>
                  {/if}

                  <span class="pollster-value">{dateStr}</span>
                  <span class="pollster-separator">•</span>



                {:else}
                  <span class="poll-id-label">Status:</span>
                  {#if pollId === 'not_enough_information'}
                    <span class="poll-id-value no-match">Not Enough Information</span>
                  {:else}
                    <span class="poll-id-value no-match">No Match</span>
                  {/if}
                {/if}
              </div>
              <span class="article-count">{items.length} article{items.length !== 1 ? 's' : ''}</span>
            </div>

            {#if !collapsedGroups[pollId]}
            <div class="group-table-wrapper">
              <table class="group-table">
                <thead>
                  <tr>
                    <th class="sortable" on:click={() => sortGroupedData('added_on')}>
                      Added On
                      {#if groupSortColumn === 'added_on'}
                        <span class="sort">{groupSortDirection === 'asc' ? '▲' : '▼'}</span>
                      {/if}
                    </th>
                    <th class="sortable" on:click={() => sortGroupedData('url')}>
                      URL
                      {#if groupSortColumn === 'url'}
                        <span class="sort">{groupSortDirection === 'asc' ? '▲' : '▼'}</span>
                      {/if}
                    </th>
                    <th class="sortable" on:click={() => sortGroupedData('pollster')}>
                      Pollster
                      {#if groupSortColumn === 'pollster'}
                        <span class="sort">{groupSortDirection === 'asc' ? '▲' : '▼'}</span>
                      {/if}
                    </th>
                    <th class="sortable" on:click={() => sortGroupedData('sponsor')}>
                      Sponsor
                      {#if groupSortColumn === 'sponsor'}
                        <span class="sort">{groupSortDirection === 'asc' ? '▲' : '▼'}</span>
                      {/if}
                    </th>
                    <th>Date</th>
                    <th>Sample Size</th>
                    {#if pollId === 'No Match'}
                      <th class="sortable" on:click={() => sortGroupedData('temp_poll_id')}>
                        Temp Poll ID
                        {#if groupSortColumn === 'temp_poll_id'}
                          <span class="sort">{groupSortDirection === 'asc' ? '▲' : '▼'}</span>
                        {/if}
                      </th>
                    {/if}
                  </tr>
                </thead>
                <tbody>
                  {#each items as item}
                    {@const url = new URL(item.url)}
                    {@const domain = url.hostname.replace('www.', '')}
                    {@const path = url.pathname + url.search}
                    {@const dateObj = new Date(item.added_on)}
                    {@const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {@const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                    {@const pollsArray = Array.isArray(item.polls) ? item.polls : [item.polls]}
                    {#if item.match_results}
                      {@const matchData = typeof item.match_results === 'string' ? JSON.parse(item.match_results) : item.match_results}
                      {#each pollsArray as rawPoll}
                        {@const poll = coercePoll(rawPoll)}
                        {#if poll}
                          <tr>
                            <td class="date-cell">
                              <div class="date">{dateStr}</div>
                              <div class="time">{timeStr}</div>
                            </td>
                            <td class="url-cell">
                              <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}>
                                <span class="url-domain">{domain}</span>
                                <span class="url-path">{path.length > 40 ? path.substring(0, 40) + '…' : path}</span>
                              </a>
                            </td>
                            <td>{poll.pollster || 'N/A'}</td>
                            <td>{poll.sponsor || 'N/A'}</td>
                            <td>{poll.start_date || poll.date || 'N/A'}</td>
                            <td>{getSample(poll)}</td>
                            {#if pollId === 'No Match'}
                              <td class="temp-poll-id-cell">
                                {#if item.temp_poll_id}
                                  <div class="temp-id-container">
                                    <span class="temp-id-badge">{item.temp_poll_id}</span>
                                    {#if tempPollFirstSeen[item.temp_poll_id]}
                                      {@const firstDate = new Date(tempPollFirstSeen[item.temp_poll_id])}
                                      <span class="first-seen-tag">First seen {firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    {:else}
                                      <span class="new-poll-tag">New Poll</span>
                                    {/if}
                                  </div>
                                {:else}
                                  N/A
                                {/if}
                              </td>
                            {/if}
                          </tr>
                        {/if}
                      {/each}
                    {:else}
                      {#each pollsArray as rawPoll}
                        {@const poll = coercePoll(rawPoll)}
                        {#if poll}
                          <tr>
                            <td class="date-cell">
                              <div class="date">{dateStr}</div>
                              <div class="time">{timeStr}</div>
                            </td>
                            <td class="url-cell">
                              <a href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}>
                                <span class="url-domain">{domain}</span>
                                <span class="url-path">{path.length > 40 ? path.substring(0, 40) + '…' : path}</span>
                              </a>
                            </td>
                            <td>{poll.pollster || 'N/A'}</td>
                            <td>{poll.sponsor || 'N/A'}</td>
                            <td>{poll.start_date || poll.date || 'N/A'}</td>
                            <td>{getSample(poll)}</td>
                            {#if pollId === 'No Match'}
                              <td class="temp-poll-id-cell">
                                {#if item.temp_poll_id}
                                  <div class="temp-id-container">
                                    <span class="temp-id-badge">{item.temp_poll_id}</span>
                                    {#if tempPollFirstSeen[item.temp_poll_id]}
                                      {@const firstDate = new Date(tempPollFirstSeen[item.temp_poll_id])}
                                      <span class="first-seen-tag">First seen {firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                    {:else}
                                      <span class="new-poll-tag">New Poll</span>
                                    {/if}
                                  </div>
                                {:else}
                                  N/A
                                {/if}
                              </td>
                            {/if}
                          </tr>
                        {/if}
                      {/each}
                    {/if}
                  {/each}
                </tbody>
              </table>
            </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="notice">No data found.</div>
  {/if}
</main>

<!-- ====== FOOTER ====== -->
<footer class="site-footer">
  <div class="container footer-inner">
    <p id="about" class="muted">© {new Date().getFullYear()} Pollfinder • Built for structured poll discovery.</p>
  </div>
</footer>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --ink: #1a1a2e;
    --ink-2: #4a4a68;
    --ink-3: #8888a4;
    --paper: #ffffff;
    --paper-2: #f5f6fa;
    --line: #e4e6ef;
    --brand: #1e4a8a;
    --brand-2: #163d72;
    --brand-light: #eef2f9;
    --accent: #0ea5e9;
    --warn: #d97706;
    --success: #059669;
    --danger: #dc2626;
    --radius-sm: 0;
    --radius: 0;
    --radius-lg: 0;
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
    --shadow: 0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --shadow-lg: 0 8px 24px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
    --transition: 0.15s ease;
  }

  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--paper-2);
    color: var(--ink);
    font-family: Inter, system-ui, -apple-system, sans-serif;
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  h1 {
    font-weight: 800;
    font-size: clamp(28px, 3.5vw, 42px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 0 0 0.25rem;
    color: var(--ink);
  }
  .dek {
    font-size: 1rem;
    color: var(--ink-2);
    max-width: 55ch;
    margin: 0.25rem 0 1.5rem;
    line-height: 1.6;
  }
  a { color: var(--brand); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted {
    color: var(--ink-3);
    font-size: 0.8rem;
    line-height: 1.3;
    font-style: italic;
  }

  .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

  /* ── HEADER ── */
  .site-header {
    background: #0f172a;
    color: #fff;
    position: sticky;
    top: 0;
    z-index: 50;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .site-header__inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #fff;
    text-decoration: none;
  }
  .brand__glyph {
    width: 20px; height: 20px;
    stroke: #60a5fa;
    stroke-width: 2.2;
    fill: none;
  }
  .brand__name {
    font-weight: 800;
    font-size: 1rem;
    letter-spacing: 0.01em;
  }
  .top-nav a {
    color: #94a3b8;
    margin-left: 20px;
    font-weight: 500;
    font-size: 0.875rem;
    transition: color var(--transition);
  }
  .top-nav a:hover { color: #fff; text-decoration: none; }

  /* ── HERO ── */
  .hero {
    display: grid;
    grid-template-columns: 1fr;
    padding: 32px 0 8px;
  }
  .hero__copy { padding-top: 0; }
  .hero__art { display: none; }

  /* ── FILTERS ── */
  .filters {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: center;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px 16px;
    box-shadow: var(--shadow-sm);
  }
  .field { display: flex; align-items: center; gap: 8px; }
  label {
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--ink-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input[type="date"], select {
    appearance: none;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--paper);
    font: inherit;
    font-size: 0.875rem;
    min-width: 200px;
    outline: none;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  input[type="date"]:focus, select:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(30, 74, 138, 0.1);
  }

  /* ── VIEW TOGGLE ── */
  .view-toggle {
    display: flex;
    gap: 0;
    background: var(--paper);
    padding: 3px;
    border-radius: var(--radius);
    margin: 20px 0;
    width: fit-content;
    border: 1px solid var(--line);
    box-shadow: var(--shadow-sm);
  }
  .view-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border: none;
    background: transparent;
    color: var(--ink-3);
    font-weight: 600;
    font-size: 0.825rem;
    cursor: pointer;
    border-radius: calc(var(--radius) - 3px);
    transition: all var(--transition);
    white-space: nowrap;
  }
  .view-btn:hover {
    color: var(--ink-2);
    background: var(--paper-2);
  }
  .view-btn.active {
    background: var(--brand);
    color: #fff;
    box-shadow: none;
  }
  .view-icon { width: 16px; height: 16px; flex-shrink: 0; }

  .btn {
    border: 1px solid var(--line);
    background: var(--paper);
    padding: 8px 14px;
    font-weight: 600;
    font-size: 0.825rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .btn.ghost { background: transparent; color: var(--ink-3); }
  .btn:hover {
    border-color: #cbd5e1;
    background: var(--paper-2);
  }

  /* ── FEEDBACK BUTTONS ── */
  .feedback-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .btn-feedback {
    padding: 5px 10px;
    border: 1px solid var(--line);
    background: var(--paper);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all var(--transition);
  }
  .btn-feedback:hover {
    border-color: #94a3b8;
    background: var(--paper-2);
  }
  .btn-feedback.selected {
    background: var(--success);
    border-color: var(--success);
    color: #fff;
  }
  .btn-feedback:nth-child(2).selected {
    background: var(--danger);
    border-color: var(--danger);
  }
  .btn-feedback.btn-not-interested.selected {
    background: #94a3b8;
    border-color: #94a3b8;
    color: #fff;
  }

  /* ── NOTES ── */
  .notes-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notes-input {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font-size: 0.825rem;
    font-family: inherit;
    background: var(--paper);
    transition: border-color var(--transition), box-shadow var(--transition);
    resize: vertical;
    min-height: 60px;
    max-width: 250px;
  }
  .notes-input:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 3px rgba(30, 74, 138, 0.1);
  }
  .notes-input::placeholder { color: #b0b4c0; }

  /* ── CARDS ── */
  .card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .table-card { margin: 16px 0 48px; }

  /* ── TABLE ── */
  .table-scroll { overflow: auto; border-radius: var(--radius); }
  table { width: 100%; border-collapse: separate; border-spacing: 0; }
  thead th {
    position: sticky; top: 0;
    background: var(--paper-2);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.7rem;
    border-bottom: 1px solid var(--line);
    color: var(--ink-3);
    padding: 10px 12px;
  }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { background: #eceef5; }
  .sort { margin-left: 4px; font-size: 0.7rem; color: var(--ink-3); }

  tbody td {
    padding: 10px 12px;
    border-top: 1px solid var(--line);
    vertical-align: top;
    background: var(--paper);
    font-size: 0.875rem;
  }
  tbody tr:nth-child(odd) td { background: #fafafc; }
  tbody tr:hover td { background: #f0f2f8; }

  .datetime {
    display: flex;
    flex-direction: column;
    gap: 1px;
    line-height: 1.3;
    white-space: nowrap;
  }
  .datetime .date {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--ink);
  }
  .datetime .time {
    font-size: 0.7rem;
    color: var(--ink-3);
  }

  .url-link {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-decoration: none;
    color: inherit;
    line-height: 1.3;
    max-width: 300px;
  }
  .url-link:hover { opacity: 0.85; }
  .url-link:hover .url-domain { text-decoration: underline; }
  .url-domain {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--brand);
  }
  .url-path {
    font-size: 0.7rem;
    color: var(--ink-3);
    font-family: 'SF Mono', Menlo, monospace;
    word-break: break-all;
  }

  .poll-id-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--brand-light);
    border: 1px solid #bfdbfe;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
  }
  .badge-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--brand-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .badge-value {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--brand-2);
    font-family: 'SF Mono', Menlo, monospace;
  }

  .badge-potential {
    display: inline-block;
    padding: 3px 8px;
    margin-bottom: 0.4rem;
    font-size: 0.7rem;
    font-weight: 600;
    color: #92400e;
    background: #fef3c7;
    border: 1px solid #fcd34d;
    border-radius: 0;
  }

  .match-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: #f8f9fc;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    min-width: 240px;
  }
  .match-field {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .field-label {
    font-weight: 600;
    color: var(--ink-3);
    min-width: 65px;
    flex-shrink: 0;
  }
  .field-value {
    color: var(--ink);
    font-weight: 400;
  }

  .polls-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: #f8f9fc;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    min-width: 240px;
  }
  .poll-more {
    font-size: 0.7rem;
    color: var(--ink-3);
    font-style: italic;
    padding-top: 4px;
    border-top: 1px solid var(--line);
    margin-top: 2px;
  }

  /* ── GROUPED VIEW ── */
  .grouped-view {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 32px;
  }
  .group-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0;
    overflow: hidden;
    box-shadow: var(--shadow);
    transition: box-shadow var(--transition), border-color var(--transition);
  }
  .group-card:hover {
    border-color: #c8ccd8;
  }

  .group-header-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    background: var(--paper-2);
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    transition: background var(--transition);
  }
  .group-header-row:hover {
    background: #eceef5;
  }

  .collapse-btn {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 2px 7px;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition);
    color: var(--ink-3);
    flex-shrink: 0;
    line-height: 1.4;
  }
  .collapse-btn:hover {
    background: var(--paper);
    border-color: #94a3b8;
    color: var(--ink);
  }

  .header-content {
    display: flex;
    gap: 6px;
    align-items: center;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
  }
  .poll-id-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .poll-id-value {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--brand);
    font-family: 'SF Mono', Menlo, monospace;
  }
  .poll-id-value.no-match {
    color: var(--danger);
    font-family: inherit;
  }

  .pollster-separator {
    color: #d0d4e0;
    margin: 0 4px;
    font-size: 0.7rem;
  }
  .pollster-label {
    font-size: 0.65rem;
    font-weight: 700;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pollster-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }

  .article-count {
    margin-left: auto;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--ink-3);
    background: var(--paper);
    padding: 3px 10px;
    border: 1px solid var(--line);
    border-radius: 0;
    white-space: nowrap;
  }
  .group-card .match-card { display: none; }
  .match-title {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--ink-2);
    margin: 0 0 8px;
  }
  .items-title {
    font-size: 0.825rem;
    font-weight: 700;
    color: var(--ink-2);
    margin: 0 0 12px;
  }
  .group-table-wrapper {
    overflow-x: auto;
    margin-top: 0;
    background: var(--paper);
  }
  .group-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.825rem;
    background: var(--paper);
    table-layout: fixed;
  }
  .group-table th {
    text-align: left;
    padding: 10px 18px;
    font-weight: 700;
    color: var(--ink-3);
    white-space: nowrap;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    width: 16.66%;
    border-bottom: 1px solid var(--line);
    background: #fafafc;
  }
  .group-table td {
    padding: 12px 18px;
    border-bottom: 1px solid #f0f1f5;
    color: var(--ink);
    vertical-align: top;
  }
  .group-table tbody tr {
    transition: background var(--transition);
  }
  .group-table tbody tr:hover {
    background: #f5f6fa;
  }
  .group-table tbody tr:last-child td {
    border-bottom: none;
  }

  .temp-id-container {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .temp-id-badge {
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 0.75rem;
    color: var(--brand);
    font-weight: 600;
    background: var(--brand-light);
    padding: 2px 8px;
    border: 1px solid #c7d2fe;
  }
  .new-poll-tag {
    font-size: 0.65rem;
    font-weight: 700;
    color: #fff;
    background: var(--success);
    padding: 2px 7px;
    border-radius: 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .first-seen-tag {
    font-size: 0.65rem;
    font-weight: 700;
    color: #fff;
    background: #6366f1;
    padding: 2px 7px;
    border-radius: 0;
    letter-spacing: 0.02em;
  }
  .date-cell { white-space: nowrap; }
  .date-cell .date {
    font-weight: 600;
    font-size: 0.825rem;
  }
  .date-cell .time {
    font-size: 0.7rem;
    color: var(--ink-3);
  }
  .url-cell a {
    text-decoration: none;
    color: inherit;
  }
  .url-cell a:hover .url-domain { text-decoration: underline; }
  .url-cell .url-domain {
    font-weight: 600;
    color: var(--brand);
    display: block;
    font-size: 0.825rem;
  }
  .url-cell .url-path {
    font-size: 0.7rem;
    color: var(--ink-3);
    font-family: 'SF Mono', Menlo, monospace;
    display: block;
  }

  .link-wrap { word-break: break-word; }
  .json {
    background: #f8f9fc;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 8px;
    font-size: 0.8rem;
    max-width: 360px;
    overflow: auto;
  }

  /* ── NOTICES ── */
  .notice {
    background: var(--brand-light);
    border: 1px solid #bfdbfe;
    color: var(--brand-2);
    padding: 12px 16px;
    margin: 16px 0;
    border-radius: var(--radius);
    font-size: 0.875rem;
    font-weight: 500;
  }
  .notice.error {
    background: #fef2f2;
    border-color: #fecaca;
    color: #991b1b;
  }

  /* ── FOOTER ── */
  .site-footer {
    border-top: 1px solid var(--line);
    background: var(--paper);
    margin-top: 24px;
  }
  .footer-inner { padding: 24px; }

  /* ── RESPONSIVE ── */
  @media (max-width: 960px) {
    .hero { grid-template-columns: 1fr; }
    .container { padding: 0 16px; }
  }

  .table-card .data-table a { color: var(--brand); }
  .table-card .data-table a:hover { opacity: 0.85; }
  .table-card {
    margin: 16px 0 48px;
    width: 100%;
    overflow-x: visible;
  }
  .table-card .data-table {
    table-layout: auto;
    width: 100%;
    min-width: auto;
  }
</style>
