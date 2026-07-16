/**
 * Utility functions for printing tournament data
 */

/**
 * Opens printable HTML in a new tab and lets the user print it reliably.
 *
 * We deliberately avoid `window.open('') + document.write()`: Chromium treats that
 * popup as the initial about:blank document and can discard the written DOM a moment
 * later (the tab goes blank ~2s after Print) and/or snapshot an unsettled document
 * when Print is pressed (blank printout). Loading the HTML through a Blob URL yields a
 * real, committed document, so both the on-screen page and the printout render.
 */
const openPrintWindow = (html: string): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups for this site to print');
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  printWindow.location.href = url;
  // Release the blob once the document has had time to load.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/** Escape user-provided text (player names) so it can't break the print layout or inject markup. */
const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Prints the final standings of a tournament in a printer-friendly format
 *
 * @param participants - Array of participant objects containing ranking information
 * @param tournamentName - Name of the tournament
 * @returns void - Opens a new window with printable content
 */
export const printFinalStandings = (
  participants: any[],
  tournamentName?: string | null,
): void => {
  const pageTitle = tournamentName
    ? `${tournamentName} - Final Standings`
    : `Final Tournament Standings`;
  
  // Sort participants by match points (desc) then by differential (desc)
  const sortedParticipants = [...participants].sort((a, b) => {
    // Dropped players always rank after active players
    if (a.dropped_out !== b.dropped_out) return a.dropped_out ? 1 : -1;

    const mpA = a.match_points !== null ? a.match_points : -Infinity;
    const mpB = b.match_points !== null ? b.match_points : -Infinity;

    if (mpA !== mpB) {
      return mpB - mpA; // sort descending by match_points
    }

    const diffA = a.differential !== null ? a.differential : -Infinity;
    const diffB = b.differential !== null ? b.differential : -Infinity;
    return diffB - diffA; // sort descending by differential if match_points are equal
  });
  
  // Create the print content HTML header
  let printContent = `
    <html>
      <head>
        <title>${pageTitle}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          h1 { text-align: center; margin-bottom: 20px; }
          .logo { max-width: 150px; margin: 0 auto 20px; display: block; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background-color: #f2f2f2; padding: 8px; text-align: left; border-bottom: 2px solid #ddd; }
          td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          .winner { font-weight: bold; background-color: #fff8e0; }
          @media print {
            button { display: none; }
            @page { margin: 0.5cm; }
          }
        </style>
      </head>
      <body>
        <img src="${window.location.origin}/lightmode_redemptionccgapp.webp" alt="RedemptionCCG App Logo" class="logo" />
        <h1>${pageTitle}</h1>
        <button onclick="window.print();return false;" style="padding:10px 20px; margin:10px 0; background:#4a90e2; color:white; border:none; border-radius:4px; cursor:pointer;">Print</button>
  `;

  // Add standings table
  if (sortedParticipants && sortedParticipants.length > 0) {
    printContent += `
      <table>
        <thead>
          <tr>
            <th>Place</th>
            <th>Name</th>
            <th>Match Points</th>
            <th>Differential</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    // Track places correctly, handling ties
    let places = [];
    let currentRank = 1;
    
    // First assign ranks properly handling ties
    for (let i = 0; i < sortedParticipants.length; i++) {
      if (i > 0) {
        const prev = sortedParticipants[i-1];
        const current = sortedParticipants[i];
        
        // If current participant has same points and differential as previous one, give them the same rank
        if (current.match_points === prev.match_points && current.differential === prev.differential) {
          places.push(places[i-1]); // Same place as previous participant
        } else {
          places.push(i + 1); // New place (1-based indexing)
        }
      } else {
        places.push(1); // First place for first participant
      }
    }
    
    // Now render each row with the correct place number
    for (let i = 0; i < sortedParticipants.length; i++) {
      const participant = sortedParticipants[i];
      const isWinner = i === 0;
      
      printContent += `
        <tr class="${isWinner ? 'winner' : ''}">
          <td>${places[i]}</td>
          <td>${participant.name}${participant.dropped_out ? ' (Dropped)' : ''}</td>
          <td>${participant.match_points || 0}</td>
          <td>${participant.differential || 0}</td>
        </tr>
      `;
    }
    
    printContent += `
        </tbody>
      </table>
    `;
  }
  
  // Close the HTML content
  printContent += `
      </body>
    </html>
  `;

  openPrintWindow(printContent);
};

/**
 * Prints tournament pairings in a printer-friendly format
 * 
 * @param matches - Array of match objects containing pairing information
 * @param byes - Array of bye objects containing bye information
 * @param roundNumber - Current round number
 * @param startingTableNumber - Table number to start from
 * @param tournamentName - Name of the tournament
 * @returns void - Opens a new window with printable content
 */
export const printTournamentPairings = (
  matches: any[],
  byes: any[],
  roundNumber: number,
  startingTableNumber: number = 1,
  tournamentName?: string | null,
  numberingMode: 'tables' | 'seats' = 'tables',
): void => {
  const heading = tournamentName || 'Tournament';
  const pageTitle = tournamentName
    ? `${tournamentName} - Round ${roundNumber} Pairings`
    : `Round ${roundNumber} Pairings`;

  // One compact line per table: [table #] Player 1 vs Player 2. These flow into
  // CSS multi-columns (newspaper order) so a whole large-tournament round fits on a
  // single projected screen without scrolling and is easy to scan by table number.
  const pairingsHtml = (matches || [])
    .map((match, index) => {
      const table = match.table_number ?? index + startingTableNumber;
      if (numberingMode === 'seats') {
        // Per-chair numbers replace the single table badge.
        return `
        <li class="pair pair-seats">
          <span class="names">
            <span class="seat">${2 * table - 1}</span>
            <span class="p">${escapeHtml(match.player1_id?.name)}</span>
            <span class="vs">vs</span>
            <span class="seat">${2 * table}</span>
            <span class="p">${escapeHtml(match.player2_id?.name)}</span>
          </span>
        </li>`;
      }
      return `
        <li class="pair">
          <span class="t">${table}</span>
          <span class="names">
            <span class="p">${escapeHtml(match.player1_id?.name)}</span>
            <span class="vs">vs</span>
            <span class="p">${escapeHtml(match.player2_id?.name)}</span>
          </span>
        </li>`;
    })
    .join('');

  // Byes render as a single compact strip below the pairings rather than a
  // second full table, so they don't push the pairings off-screen.
  const byesHtml =
    byes && byes.length > 0
      ? `
        <div class="byes">
          <span class="byes-label">Byes</span>
          ${byes
            .map((bye) => `<span class="bye-name">${escapeHtml(bye.participant_id?.name)}</span>`)
            .join('')}
        </div>`
      : '';

  const printContent = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(pageTitle)}</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; }
          html, body { margin: 0; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #111;
            padding: 14px 22px 22px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Slim header: small logo, tournament name, round badge. Keeps the
             vertical budget for the pairings themselves. */
          .header {
            display: flex; align-items: center; gap: 14px;
            border-bottom: 3px solid #111;
            padding-bottom: 8px; margin-bottom: 14px;
            padding-right: 96px; /* reserve room for the fixed Print button */
          }
          .header .logo { height: 30px; width: auto; }
          .header .title { font-size: 21px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.1; }
          .header .round {
            margin-left: auto; white-space: nowrap;
            font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
            background: #111; color: #fff; padding: 5px 12px; border-radius: 4px;
          }

          /* Newspaper columns: the browser fits as many ~340px columns as the
             screen allows, so the same markup fills a 4:3 projector or a wide
             display. Table order flows down each column, then to the next. */
          .pairings {
            list-style: none; margin: 0; padding: 0;
            column-width: 340px; column-gap: 30px;
          }
          .pair {
            break-inside: avoid;
            display: grid; grid-template-columns: 30px 1fr; align-items: baseline; gap: 10px;
            padding: 5px 8px;
            font-size: 16px; line-height: 1.25;
            border-radius: 4px;
          }
          .pair:nth-child(odd) { background: #f4f4f5; }
          .pair .t {
            font-weight: 800; text-align: right; color: #555;
            font-variant-numeric: tabular-nums; font-size: 14px;
          }
          .pair .names { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
          .pair .p { font-weight: 600; }
          .pair .vs { color: #9ca3af; font-size: 12px; font-weight: 500; }
          .pair.pair-seats { grid-template-columns: 1fr; }
          .pair .seat {
            font-weight: 800; color: #555;
            font-variant-numeric: tabular-nums; font-size: 13px;
          }

          .byes {
            margin-top: 16px; padding-top: 10px; border-top: 1px solid #ddd;
            display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; font-size: 14px;
          }
          .byes-label { font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: #555; font-size: 12px; }
          .bye-name { font-weight: 600; }
          .bye-name:not(:last-child)::after { content: "·"; color: #bbb; margin-left: 14px; }

          .print-btn {
            position: fixed; top: 12px; right: 14px; z-index: 10;
            padding: 9px 18px; background: #16a34a; color: #fff;
            border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 700;
          }

          @media print {
            body { padding: 0; }
            .print-btn { display: none; }
            .header { padding-right: 0; } /* button hidden in print, reclaim the space */
            .pair:nth-child(odd) { background: #f4f4f5 !important; }
            @page { margin: 0.4cm; }
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print();return false;">Print</button>
        <div class="header">
          <img src="${window.location.origin}/lightmode_redemptionccgapp.webp" alt="" class="logo" />
          <div class="title">${escapeHtml(heading)}</div>
          <div class="round">Round ${roundNumber}</div>
        </div>
        <ol class="pairings">${pairingsHtml}</ol>
        ${byesHtml}
      </body>
    </html>
  `;

  openPrintWindow(printContent);
};

/**
 * Prints compact match slips in a printer-friendly format - multiple slips per page
 * 
 * @param matches - Array of match objects containing pairing information
 * @param roundNumber - Current round number
 * @param startingTableNumber - Table number to start from
 * @param tournamentName - Name of the tournament
 * @returns void - Opens a new window with printable content
 */
export const printMatchSlips = (
  matches: any[],
  roundNumber: number,
  startingTableNumber: number = 1,
  tournamentName?: string | null,
  numberingMode: 'tables' | 'seats' = 'tables',
): void => {
  const pageTitle = tournamentName
    ? `${tournamentName} - Round ${roundNumber} Match Slips`
    : `Round ${roundNumber} Match Slips`;

  // Generate a match slip for each match
  const matchSlipsHtml = matches.map((match, index) => {
    const tableNumber = match.table_number ?? index + startingTableNumber;
    const locationLabel = numberingMode === 'seats'
      ? `Seats ${2 * tableNumber - 1} &amp; ${2 * tableNumber}`
      : `Table ${tableNumber}`;
    const p1Seat = numberingMode === 'seats' ? `<span class="slip-seat">${2 * tableNumber - 1}</span> ` : '';
    const p2Seat = numberingMode === 'seats' ? `<span class="slip-seat">${2 * tableNumber}</span> ` : '';
    const isLastSlip = index === matches.length - 1;

    return `
      <div class="match-slip">
        <div class="match-header">
          <strong>${escapeHtml(tournamentName || 'Tournament')}</strong> - Round ${roundNumber} - ${locationLabel}
        </div>

        <table class="players-table">
          <thead>
            <tr class="header-row">
              <th class="name-header">Name</th>
              <th class="score-header">Score</th>
              <th class="signature-header">Signature</th>
            </tr>
          </thead>
          <tbody>
            <tr class="player-row">
              <td class="player-name">${p1Seat}${escapeHtml(match.player1_id?.name)}</td>
              <td class="score-cell"><div class="score-box"></div></td>
              <td class="signature-cell"><div class="signature-line"></div></td>
            </tr>
            <tr class="player-row">
              <td class="player-name">${p2Seat}${escapeHtml(match.player2_id?.name)}</td>
              <td class="score-cell"><div class="score-box"></div></td>
              <td class="signature-cell"><div class="signature-line"></div></td>
            </tr>
          </tbody>
        </table>

        <div class="instructions">Please fill in match score, have both players sign, and return to tournament organizer</div>
        ${!isLastSlip ? '<div class="cut-line"></div>' : ''}
      </div>
    `;
  }).join('');

  // Create the print content HTML
  const printContent = `
    <html>
      <head>
        <title>${pageTitle}</title>
        <style>
          @media print {
            @page {
              margin: 0.3in;
              size: letter;
            }
            body {
              -webkit-print-color-adjust: exact;
            }
            button { display: none; }
          }
          
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 10px;
            background: white;
            font-size: 12px;
          }
          
          .match-slip {
            border: 1px solid #000;
            margin-bottom: 25px;
            padding: 10px;
            page-break-inside: avoid;
            background: white;
            min-height: 115px;
            box-sizing: border-box;
            position: relative;
            width: 80%;
            margin-left: auto;
            margin-right: auto;
            display: flex;
            flex-direction: column;
          }
          
          .cut-line {
            position: absolute;
            bottom: -12px;
            left: 10%;
            right: 10%;
            border-bottom: 2px dotted #666;
            text-align: center;
            font-size: 8px;
            color: #999;
            height: 2px;
          }
          
          .cut-line::before {
            content: "✂ cut here";
            background: white;
            padding: 0 8px;
            position: relative;
            top: -6px;
          }
          
          .match-header {
            text-align: center;
            font-size: 11px;
            margin-bottom: 6px;
            padding-bottom: 3px;
            border-bottom: 1px solid #ccc;
          }
          
          .players-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 6px;
            table-layout: fixed;
            flex-shrink: 0;
          }
          
          .header-row {
            height: 20px;
            background-color: #f0f0f0;
          }
          
          .name-header, .score-header, .signature-header {
            font-size: 10px;
            font-weight: bold;
            text-align: center;
            padding: 3px 4px;
            border: 1px solid #ccc;
            background-color: #f0f0f0;
          }
          
          .name-header {
            width: 55%;
          }
          
          .score-header {
            width: 15%;
          }
          
          .signature-header {
            width: 30%;
          }
          
          .player-row {
            height: 26px;
            border: none;
          }
          
          .player-name {
            font-weight: bold;
            font-size: 12px;
            padding: 4px 8px;
            border: 1px solid #ccc;
            background: #f9f9f9;
            width: 55%;
            text-align: left;
            vertical-align: middle;
          }

          .slip-seat { color: #888; font-weight: normal; }

          .score-cell {
            text-align: center;
            padding: 4px;
            border: 1px solid #ccc;
            width: 15%;
            vertical-align: middle;
          }
          
          .score-box {
            width: 28px;
            height: 20px;
            border: 2px solid #000;
            background: white;
            margin: 0 auto;
            display: block;
          }
          
          .signature-cell {
            padding: 4px 8px;
            border: 1px solid #ccc;
            width: 30%;
            vertical-align: middle;
          }
          
          .signature-line {
            border-bottom: 1px solid #000;
            height: 16px;
            width: 100%;
          }
          
          .instructions {
            font-size: 9px;
            color: #666;
            text-align: center;
            margin-top: auto;
            margin-bottom: 5px;
            font-style: italic;
            line-height: 1.2;
            flex-shrink: 0;
          }
        </style>
      </head>
      <body>
        <button onclick="window.print();return false;" style="position:fixed; top:10px; right:10px; padding:10px 20px; background:#4a90e2; color:white; border:none; border-radius:4px; cursor:pointer; z-index:1000;">Print All Slips</button>
        ${matchSlipsHtml}
      </body>
    </html>
  `;

  openPrintWindow(printContent);
};