// championship_calculator.js
(function () {
    function qs(id) { return document.getElementById(id); }
  
    // Called when you press the button
    window.openPointsCalculator = function (champData) {
      if (!champData) {
        alert('No championship data available yet.');
        return;
      }
  
      // For now, just show a summary + log the raw object.
      console.log('[Calculator] Received championship data:', champData);
  
      const body = qs('calcModalBody');
      body.innerHTML = `
        <h3 style="margin:0 0 10px 0;">Title scenarios (coming soon)</h3>
        <p><strong>${champData.seasonName}</strong> — ${champData.carClass || ''}</p>
        <p>Events completed: <strong>${champData.eventsCompleted}</strong> / ${champData.eventCount}
           &nbsp;•&nbsp; Drops: <strong>${champData.safeDropRaces}</strong></p>
        <p>Drivers: ${Object.keys(champData.driverNames || {}).length}</p>
        <p style="font-size:12px;color:#555">Open the console to see the raw object we’ll use for the maths.</p>
      `;
  
      qs('calcModal').style.display = 'flex';
    };
  
    window.closePointsCalculator = function () {
      const el = document.getElementById('calcModal');
      if (el) el.style.display = 'none';
    };
  
    // Click the dark backdrop to close
    document.addEventListener('click', (e) => {
      const modal = document.getElementById('calcModal');
      if (!modal || modal.style.display !== 'flex') return;
      if (e.target === modal) window.closePointsCalculator();
    });
  })();
  