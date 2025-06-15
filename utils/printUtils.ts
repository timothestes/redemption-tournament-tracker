/**
 * Utility functions for printing tournament data
 */

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
  // Create a printable version of the standings
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups for this site to print standings');
    return;
  }
  
  const pageTitle = tournamentName 
    ? `${tournamentName} - Final Standings`
    : `Final Tournament Standings`;
  
  // Sort participants by match points (desc) then by differential (desc)
  const sortedParticipants = [...participants].sort((a, b) => {
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
        <img src="/lor-lightmode.png" alt="Tournament Logo" class="logo" />
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
  
  // Write to the new window and close the document writing
  printWindow.document.write(printContent);
  printWindow.document.close();
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
  tournamentName?: string | null
): void => {
  // Create a printable version of the pairings that only shows essential info
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups for this site to print pairings');
    return;
  }
  
  const pageTitle = tournamentName 
    ? `${tournamentName} - Round ${roundNumber} Pairings`
    : `Round ${roundNumber} Pairings`;
  
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
          .bye { background-color: #f8f8f8; }
          @media print {
            button { display: none; }
            @page { margin: 0.5cm; }
          }
        </style>
      </head>
      <body>
        <img src="/lor-lightmode.png" alt="Tournament Logo" class="logo" />
        <h1>${pageTitle}</h1>
        <button onclick="window.print();return false;" style="padding:10px 20px; margin:10px 0; background:#4a90e2; color:white; border:none; border-radius:4px; cursor:pointer;">Print</button>
  `;
  
  // Add matches table
  if (matches && matches.length > 0) {
    printContent += `
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>Seat 1</th>
            <th>Seat 2</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    matches.forEach((match, index) => {
      printContent += `
        <tr>
          <td>${index + startingTableNumber}</td>
          <td>${match.player1_id.name}</td>
          <td>${match.player2_id.name}</td>
        </tr>
      `;
    });
    
    printContent += `
        </tbody>
      </table>
    `;
  }
  
  // Add byes table if any
  if (byes && byes.length > 0) {
    printContent += `
      <h2>Byes</h2>
      <table>
        <thead>
          <tr>
            <th>Player</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    byes.forEach((bye) => {
      printContent += `
        <tr class="bye">
          <td>${bye.participant_id.name}</td>
        </tr>
      `;
    });
    
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
  
  // Write to the new window and close the document writing
  printWindow.document.write(printContent);
  printWindow.document.close();
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
  tournamentName?: string | null
): void => {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups for this site to print match slips');
    return;
  }
  
  const pageTitle = tournamentName 
    ? `${tournamentName} - Round ${roundNumber} Match Slips`
    : `Round ${roundNumber} Match Slips`;
  
  // Generate a match slip for each match
  const matchSlipsHtml = matches.map((match, index) => {
    const tableNumber = index + startingTableNumber;
    const isLastSlip = index === matches.length - 1;
    
    return `
      <div class="match-slip">
        <div class="match-header">
          <strong>${tournamentName || 'Tournament'}</strong> - Round ${roundNumber} - Table ${tableNumber}
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
              <td class="player-name">${match.player1_id.name}</td>
              <td class="score-cell"><div class="score-box"></div></td>
              <td class="signature-cell"><div class="signature-line"></div></td>
            </tr>
            <tr class="player-row">
              <td class="player-name">${match.player2_id.name}</td>
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
  
  // Write to the new window and close the document writing
  printWindow.document.write(printContent);
  printWindow.document.close();
};