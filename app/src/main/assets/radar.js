// radar.js
const decades = ['<1970', '1970er', '1980er', '1990er', '2000er', '2010er', '2020er'];
let radarValues = [100, 100, 100, 100, 100, 100, 100]; // 0 bis 100

const radarSize = 400;
const center = radarSize / 2;
const maxRadius = (radarSize / 2) - 30; // Platz für Text lassen

let radarEventsInitialized = false;
let activeRadarIndex = -1;
let isPendingCenterDrag = false;
let dragStartX = 0;
let dragStartY = 0;

function clientToSvgPoint(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: center, y: center };
    return pt.matrixTransform(ctm.inverse());
}

// Ermittelt anhand der SVG-Koordinaten, welcher der 7 Punkte/Achsen gegriffen wurde
function pickRadarAxis(svgX, svgY) {
    const distFromCenter = Math.hypot(svgX - center, svgY - center);
    const hasZeroPoint = radarValues.some(v => v === 0);

    // Wenn im Zentrum gegriffen wird und mindestens ein Punkt auf 0 steht,
    // entscheidet die Ziehrichtung beim Losziehen über die Achse
    if (distFromCenter < 28 && hasZeroPoint) {
        const firstZero = radarValues.findIndex(v => v === 0);
        return { index: firstZero, pendingCenter: true };
    }

    // Prüfe zuerst den Abstand zu den 7 aktuellen Griffpunkten
    let bestHandleIdx = -1;
    let bestHandleDist = Infinity;
    for (let i = 0; i < 7; i++) {
        const angle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
        const r = maxRadius * (radarValues[i] / 100);
        const cx = center + r * Math.cos(angle);
        const cy = center + r * Math.sin(angle);
        const d = Math.hypot(svgX - cx, svgY - cy);
        if (d < bestHandleDist) {
            bestHandleDist = d;
            bestHandleIdx = i;
        }
    }

    if (bestHandleDist <= 45) {
        return { index: bestHandleIdx, pendingCenter: (radarValues[bestHandleIdx] === 0 && distFromCenter < 28) };
    }

    // Fallback: Wähle die Achse mit dem kleinsten Winkelabstand zur Berührung
    const touchAngle = Math.atan2(svgY - center, svgX - center);
    let bestAxisIdx = 0;
    let bestAngleDiff = Infinity;
    for (let i = 0; i < 7; i++) {
        const axisAngle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
        const diff = Math.abs(Math.atan2(Math.sin(touchAngle - axisAngle), Math.cos(touchAngle - axisAngle)));
        if (diff < bestAngleDiff) {
            bestAngleDiff = diff;
            bestAxisIdx = i;
        }
    }
    return { index: bestAxisIdx, pendingCenter: false };
}

function updateRadarValueFromPoint(svgX, svgY) {
    if (activeRadarIndex < 0) return;

    if (isPendingCenterDrag) {
        const moveDx = svgX - dragStartX;
        const moveDy = svgY - dragStartY;
        const distFromStart = Math.hypot(moveDx, moveDy);

        if (distFromStart > 5) {
            const dragAngle = Math.atan2(moveDy, moveDx);
            let bestDiff = Infinity;
            let bestIndex = activeRadarIndex;

            for (let j = 0; j < 7; j++) {
                if (radarValues[j] === 0) {
                    const axisAngle = (Math.PI * 2 * j / 7) - (Math.PI / 2);
                    const diff = Math.abs(Math.atan2(Math.sin(dragAngle - axisAngle), Math.cos(dragAngle - axisAngle)));
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        bestIndex = j;
                    }
                }
            }
            activeRadarIndex = bestIndex;
            isPendingCenterDrag = false;
        } else {
            return;
        }
    }

    const dx = svgX - center;
    const dy = svgY - center;
    const currentAxisAngle = (Math.PI * 2 * activeRadarIndex / 7) - (Math.PI / 2);
    const axisX = Math.cos(currentAxisAngle);
    const axisY = Math.sin(currentAxisAngle);

    const projectedDist = (dx * axisX) + (dy * axisY);
    const newVal = Math.max(0, Math.min(100, (projectedDist / maxRadius) * 100));

    radarValues[activeRadarIndex] = Math.round(newVal);
    syncToUI();
    drawRadar();
}

function finishRadarDrag() {
    if (activeRadarIndex === -1) return;
    activeRadarIndex = -1;
    isPendingCenterDrag = false;

    if (radarValues.reduce((a, b) => a + b, 0) === 0) {
        radarValues = [100, 100, 100, 100, 100, 100, 100];
        syncToUI();
        drawRadar();
    }
}

// Registriert Mouse- und Touch-Events einmalig auf dem persistenten <svg>-Element
// (Wichtig für Android: da drawRadar() das Innere des SVGs neu aufbaut, darf das Touch-Target
// nicht ein Kind-Element sein, das beim Ziehen aus dem DOM gelöscht wird!)
function ensureRadarDragListeners(svg) {
    if (radarEventsInitialized || !svg) return;
    radarEventsInitialized = true;

    // --- TOUCH EVENTS (Smartphone / Tablet) ---
    svg.addEventListener('touchstart', function (e) {
        if (!e.touches || e.touches.length === 0) return;
        e.preventDefault(); // Verhindert das Scrollen der Seite beim Wischen im Radar

        const touch = e.touches[0];
        const svgP = clientToSvgPoint(svg, touch.clientX, touch.clientY);
        dragStartX = svgP.x;
        dragStartY = svgP.y;

        const picked = pickRadarAxis(svgP.x, svgP.y);
        activeRadarIndex = picked.index;
        isPendingCenterDrag = picked.pendingCenter;

        if (!isPendingCenterDrag) {
            updateRadarValueFromPoint(svgP.x, svgP.y);
        }
    }, { passive: false });

    svg.addEventListener('touchmove', function (e) {
        if (activeRadarIndex < 0 || !e.touches || e.touches.length === 0) return;
        e.preventDefault(); // Verhindert das Scrollen der Seite beim Ziehen

        const touch = e.touches[0];
        const svgP = clientToSvgPoint(svg, touch.clientX, touch.clientY);
        updateRadarValueFromPoint(svgP.x, svgP.y);
    }, { passive: false });

    svg.addEventListener('touchend', function (e) {
        if (activeRadarIndex >= 0) {
            e.preventDefault();
            finishRadarDrag();
        }
    }, { passive: false });

    svg.addEventListener('touchcancel', function () {
        finishRadarDrag();
    });

    // --- MOUSE EVENTS (PC / Browser) ---
    svg.addEventListener('mousedown', function (e) {
        e.preventDefault();
        const svgP = clientToSvgPoint(svg, e.clientX, e.clientY);
        dragStartX = svgP.x;
        dragStartY = svgP.y;

        const picked = pickRadarAxis(svgP.x, svgP.y);
        activeRadarIndex = picked.index;
        isPendingCenterDrag = picked.pendingCenter;

        if (!isPendingCenterDrag) {
            updateRadarValueFromPoint(svgP.x, svgP.y);
        }
    });

    document.addEventListener('mousemove', function (e) {
        if (activeRadarIndex < 0) return;
        const svgP = clientToSvgPoint(svg, e.clientX, e.clientY);
        updateRadarValueFromPoint(svgP.x, svgP.y);
    });

    document.addEventListener('mouseup', function () {
        if (activeRadarIndex >= 0) {
            finishRadarDrag();
        }
    });
}

function drawRadar() {
    const svg = document.getElementById('radar-svg');
    if (!svg) return;

    ensureRadarDragListeners(svg);
    svg.innerHTML = ''; // Clear

    // Hintergrund-Gitter (7-Eck) zeichnen (Ringe bei 25%, 50%, 75%, 100%)
    [0.25, 0.5, 0.75, 1].forEach(level => {
        let points = decades.map((_, i) => {
            let angle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
            let r = maxRadius * level;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(' ');
        
        let polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polygon.setAttribute("points", points);
        polygon.setAttribute("fill", "none");
        polygon.setAttribute("stroke", "rgba(255,255,255,0.2)");
        polygon.setAttribute("style", "pointer-events: none;");
        svg.appendChild(polygon);
    });

    // Achsen und Labels
    decades.forEach((label, i) => {
        let angle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
        let x = center + maxRadius * Math.cos(angle);
        let y = center + maxRadius * Math.sin(angle);

        // Linie
        let line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", center); line.setAttribute("y1", center);
        line.setAttribute("x2", x); line.setAttribute("y2", y);
        line.setAttribute("stroke", "rgba(255,255,255,0.3)");
        line.setAttribute("style", "pointer-events: none;");
        svg.appendChild(line);

        // Text
        let text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        
        // Radius für den Text (bisschen weiter außen als das Polygon)
        let textRadius = maxRadius + 15; 
        let textX = center + textRadius * Math.cos(angle);
        let textY = center + textRadius * Math.sin(angle);
        
        // Smarte Ausrichtung berechnen
        let cos = Math.cos(angle);
        let sin = Math.sin(angle);
        
        if (Math.abs(cos) < 0.1) {
            text.setAttribute("text-anchor", "middle");
            textY += sin > 0 ? 12 : -8;
        } else if (cos > 0) {
            text.setAttribute("text-anchor", "start");
            textX += 5;
        } else {
            text.setAttribute("text-anchor", "end");
            textX -= 5;
        }

        text.setAttribute("x", textX); 
        text.setAttribute("y", textY);
        text.setAttribute("fill", "#ccc");
        text.setAttribute("font-size", "16px");
        text.setAttribute("alignment-baseline", "middle");
        text.setAttribute("style", "pointer-events: none;");
        
        // Relative Prozentzahl berechnen
        let total = radarValues.reduce((a, b) => a + b, 0);
        let percent = total === 0 ? 0 : Math.round((radarValues[i] / total) * 100);
        
        let tspanLabel = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspanLabel.setAttribute("x", textX);
        tspanLabel.setAttribute("dy", "-5");
        tspanLabel.textContent = label;

        let tspanPercent = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        tspanPercent.setAttribute("x", textX);
        tspanPercent.setAttribute("dy", "14");
        tspanPercent.setAttribute("fill", "#0088ff");
        tspanPercent.setAttribute("font-weight", "bold");
        tspanPercent.textContent = `${percent}%`;

        text.appendChild(tspanLabel);
        text.appendChild(tspanPercent);
        svg.appendChild(text);
    });

    // Das blaue Wert-Polygon
    let valuePoints = radarValues.map((val, i) => {
        let angle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
        let r = maxRadius * (val / 100);
        return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(' ');
    
    let valuePolygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    valuePolygon.setAttribute("points", valuePoints);
    valuePolygon.setAttribute("fill", "rgba(0, 136, 255, 0.4)");
    valuePolygon.setAttribute("stroke", "#0088ff");
    valuePolygon.setAttribute("stroke-width", "2");
    valuePolygon.setAttribute("style", "pointer-events: none;");
    svg.appendChild(valuePolygon);

    // Sichtbare Anfass-Punkte
    radarValues.forEach((val, i) => {
        let angle = (Math.PI * 2 * i / 7) - (Math.PI / 2);
        let r = maxRadius * (val / 100);
        let cx = center + r * Math.cos(angle);
        let cy = center + r * Math.sin(angle);

        let visibleCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        visibleCircle.setAttribute("cx", cx); 
        visibleCircle.setAttribute("cy", cy);
        visibleCircle.setAttribute("r", 8);
        visibleCircle.setAttribute("fill", "#fff");
        visibleCircle.setAttribute("stroke", "#0088ff");
        visibleCircle.setAttribute("stroke-width", "2");
        visibleCircle.setAttribute("style", "pointer-events: none;");
        svg.appendChild(visibleCircle);
    });

    checkWarning();
}

// Synct das Radar mit den Checkboxen
function syncToUI() {
    const checkboxes = document.querySelectorAll('#decade-filters input');
    radarValues.forEach((val, i) => {
        if (checkboxes[i]) {
            checkboxes[i].checked = (val > 0);
        }
    });
}

// Wird aufgerufen, wenn jemand eine Checkbox anklickt
function updateFromCheckbox() {
    const checkboxes = document.querySelectorAll('#decade-filters input');
    let allOff = true;
    
    checkboxes.forEach((cb, i) => {
        if (cb.checked) {
            radarValues[i] = 100;
            allOff = false;
        } else {
            radarValues[i] = 0;
        }
    });

    // Sonderfall: Alle Checkboxen aus -> Alle an
    if (allOff && checkboxes.length > 0) {
        checkboxes.forEach(cb => cb.checked = true);
        radarValues = [100, 100, 100, 100, 100, 100, 100];
    }
    
    drawRadar();
}

// Prüft den Konflikt mit dem Jahres-Slider
function checkWarning() {
    const warningText = document.getElementById('radar-warning');
    if (!warningText) return;

    const minYearEl = document.getElementById('year-min-val');
    const maxYearEl = document.getElementById('year-max-val');
    if (!minYearEl || !maxYearEl) return;

    const minYear = parseInt(minYearEl.innerText);
    const maxYear = parseInt(maxYearEl.innerText);
    
    let conflict = false;
    radarValues.forEach((val, i) => {
        if (val > 0) {
            let decStart = i === 0 ? 1900 : 1960 + (i * 10); 
            let decEnd = i === 0 ? 1969 : decStart + 9;
            
            if (decEnd < minYear || decStart > maxYear) {
                conflict = true;
            }
        }
    });

    if (conflict) {
        warningText.innerText = `⚠️ Achtung: Dein Jahres-Slider (${minYear}-${maxYear}) schließt hier gewählte Jahrzehnte aus! (Jahres-Slider hat Vorrang)`;
        warningText.classList.remove('hidden');
    } else {
        warningText.classList.add('hidden');
    }
}

// Initialer Aufruf beim Start der App, damit das Radar sofort sichtbar ist
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateFromCheckbox();
    });
} else {
    updateFromCheckbox();
}
