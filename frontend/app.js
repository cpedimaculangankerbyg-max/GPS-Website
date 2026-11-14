
// Tiaong GPS Navigation - Frontend
// Map: Leaflet + OpenStreetMap
// Road data: OpenStreetMap Overpass API
// Routing: C++17 Dijkstra backend

const API_URL = "https://gps-website-7jwa.onrender.com";
const TIAONG_CENTER = [13.95, 121.32];

// Approximate bounding box covering Tiaong.
// This is a rectangular road-data area, not an official boundary.
const TIAONG_BBOX = "13.88,121.20,14.04,121.43";

const map = L.map("map").setView(TIAONG_CENTER, 14);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

let roadGraph = null;
let routeLayer = null;
let startMarker = null;
let endMarker = null;
let currentLocationMarker = null;
let currentGPSPosition = null;
const startInput = document.getElementById("startLocation");
const endInput = document.getElementById("endLocation");
const routeButton = document.getElementById("routeButton");
const statusPanel = document.getElementById("statusPanel");
const routeResults = document.getElementById("routeResults");

function setStatus(title, message, isError = false) {
    statusPanel.querySelector("strong").textContent = title;
    statusPanel.querySelector("p").textContent = message;
    statusPanel.style.background = isError ? "#fff1f0" : "#f1f7f3";
    statusPanel.querySelector(".status-icon").textContent =
        isError ? "!" : "ⓘ";
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = value => value * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadRoadNetwork() {
    setStatus("Loading road network", "Downloading real road data for Tiaong...");

    const query = `
        [out:json][timeout:90];
        (
          way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|road|track)$"](${TIAONG_BBOX});
        );
        (._;>;);
        out body;
    `;

    const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter"
    ];

    let data = null;
    let lastError = null;

    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: "data=" + encodeURIComponent(query)
            });

            if (!response.ok) {
                throw new Error(`Overpass returned HTTP ${response.status}`);
            }

            data = await response.json();
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!data) {
        throw new Error(
            "Could not download road data. Check your internet connection. " +
            (lastError?.message || "")
        );
    }

    const nodeMap = new Map();
    const ways = [];

    for (const element of data.elements) {
        if (element.type === "node") {
            nodeMap.set(String(element.id), {
                id: String(element.id),
                lat: element.lat,
                lon: element.lon
            });
        }

        if (element.type === "way" && element.nodes?.length > 1) {
            ways.push(element);
        }
    }

    const graphNodes = new Map();
    const graphEdges = [];

    function addEdge(from, to) {
        const a = nodeMap.get(String(from));
        const b = nodeMap.get(String(to));

        if (!a || !b) return;

        graphNodes.set(a.id, a);
        graphNodes.set(b.id, b);

        graphEdges.push({
            from: a.id,
            to: b.id,
            weight: haversine(a.lat, a.lon, b.lat, b.lon)
        });
    }

    for (const way of ways) {
        const tags = way.tags || {};
        const oneWay = tags.oneway;
        const isRoundabout = tags.junction === "roundabout";

        const nodes = way.nodes.map(String);
        const reverseOnly = oneWay === "-1";
        const directedOneWay = oneWay === "yes" ||
                               oneWay === "1" ||
                               oneWay === "true" ||
                               isRoundabout;

        const orderedNodes = reverseOnly ? [...nodes].reverse() : nodes;

        for (let i = 0; i < orderedNodes.length - 1; i++) {
            const from = orderedNodes[i];
            const to = orderedNodes[i + 1];

            addEdge(from, to);

            if (!directedOneWay) {
                addEdge(to, from);
            }
        }
    }

    if (graphNodes.size === 0 || graphEdges.length === 0) {
        throw new Error("No usable road network was returned for this area.");
    }

    roadGraph = {
        nodes: Array.from(graphNodes.values()),
        edges: graphEdges
    };

    setStatus(
        "Road network loaded",
        `${roadGraph.nodes.length.toLocaleString()} road points and ` +
        `${roadGraph.edges.length.toLocaleString()} directed road connections loaded.`
    );

    console.log("Tiaong road graph:", roadGraph);
}

async function searchLocation(place) {
    const query = place.toLowerCase().includes("tiaong")
        ? place
        : `${place}, Tiaong, Quezon, Philippines`;

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "ph");
    url.searchParams.set("viewbox", "121.20,14.04,121.43,13.88");
    url.searchParams.set("bounded", "1");

    const response = await fetch(url.toString(), {
        headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
        throw new Error("Location search is temporarily unavailable.");
    }

    const results = await response.json();

    if (!results.length) {
        throw new Error(`Location "${place}" was not found in the search area.`);
    }

    return {
        lat: Number(results[0].lat),
        lon: Number(results[0].lon),
        name: results[0].display_name
    };
}

function findNearestNode(location) {
    if (!roadGraph) throw new Error("Road network is not loaded.");

    let nearest = null;
    let shortestDistance = Infinity;

    for (const node of roadGraph.nodes) {
        const distance = haversine(
            location.lat,
            location.lon,
            node.lat,
            node.lon
        );

        if (distance < shortestDistance) {
            shortestDistance = distance;
            nearest = node;
        }
    }

    if (!nearest || shortestDistance > 3) {
        throw new Error(
            "No nearby mapped road was found. Try a more specific location."
        );
    }

    return nearest;
}

function clearRoute() {
    if (routeLayer) map.removeLayer(routeLayer);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);

    routeLayer = null;
    startMarker = null;
    endMarker = null;

    routeResults.classList.add("hidden");
}

async function calculateRoute() {
    const startName = startInput.value.trim();
    const endName = endInput.value.trim();

    if (!startName || !endName) {
        setStatus("Missing information", "Enter both a starting point and destination.", true);
        return;
    }

    routeButton.disabled = true;
    routeButton.querySelector("span:first-child").textContent = "Calculating...";

    clearRoute();

    try {
        if (!roadGraph) {
            await loadRoadNetwork();
        }

        setStatus("Searching locations", "Finding your starting point and destination...");

        const [start, end] = await Promise.all([
    startName === "My Current Location" && currentGPSPosition
        ? Promise.resolve(currentGPSPosition)
        : searchLocation(startName),
    searchLocation(endName)
]);
        const startNode = findNearestNode(start);
        const endNode = findNearestNode(end);

        setStatus("Calculating shortest route", "Sending the road graph to the C++ Dijkstra backend...");

        const response = await fetch(`${API_URL}/api/route`, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({
                graph: roadGraph,
                start: startNode.id,
                destination: endNode.id
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`C++ backend error (${response.status}): ${errorText}`);
        }

        const result = await response.json();

        if (!result.success || !Array.isArray(result.path) || result.path.length === 0) {
            throw new Error(result.message || "No route could be found.");
        }

        const nodeLookup = new Map(
            roadGraph.nodes.map(node => [node.id, node])
        );

        const coordinates = result.path.map(id => {
            const node = nodeLookup.get(String(id));

            if (!node) {
                throw new Error("The backend returned an unknown road point.");
            }

            return [node.lat, node.lon];
        });

        routeLayer = L.polyline(coordinates, {
            color: "#16845b",
            weight: 6,
            opacity: 0.9
        }).addTo(map);

        startMarker = L.marker([start.lat, start.lon])
            .addTo(map)
            .bindPopup("Starting point: " + startName);

        endMarker = L.marker([end.lat, end.lon])
            .addTo(map)
            .bindPopup("Destination: " + endName);

        map.fitBounds(routeLayer.getBounds(), { padding: [45, 45] });

        const distanceKm = Number(result.distance_km);
        if (!Number.isFinite(distanceKm) || distanceKm < 0) {
            throw new Error("The backend returned an invalid route distance.");
        }

        // Estimate only; actual travel time depends on road and traffic conditions.
        const estimatedMinutes = Math.round((distanceKm / 30) * 60);

        document.getElementById("distanceResult").textContent =
            `${distanceKm.toFixed(2)} km`;

        document.getElementById("timeResult").textContent =
            estimatedMinutes < 60
                ? `${estimatedMinutes} min`
                : `${Math.floor(estimatedMinutes / 60)} hr ${estimatedMinutes % 60} min`;

        routeResults.classList.remove("hidden");

        setStatus("Route successfully calculated", "Your shortest mapped road route is displayed.");
    } catch (error) {
        console.error(error);
        setStatus("Unable to calculate route", error.message, true);
    } finally {
        routeButton.disabled = false;
        routeButton.querySelector("span:first-child").textContent = "Find Shortest Route";
    }
}

routeButton.addEventListener("click", calculateRoute);

document.getElementById("clearButton").addEventListener("click", () => {
    clearRoute();
    setStatus("Route cleared", "Enter locations to calculate another route.");
});

document.getElementById("locateButton").addEventListener("click", () => {
    if (!navigator.geolocation) {
        setStatus("GPS unavailable", "Your browser does not support location services.", true);
        return;
    }

    setStatus("Finding your location", "Please allow location access in your browser.");

    navigator.geolocation.getCurrentPosition(
        position => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            currentGPSPosition = { lat, lon, name: "My Current Location" };
            if (currentLocationMarker) {
                map.removeLayer(currentLocationMarker);
            }

            currentLocationMarker = L.marker([lat, lon])
                .addTo(map)
                .bindPopup("Your current location")
                .openPopup();

            map.setView([lat, lon], 16);
            startInput.value = "My Current Location";
            setStatus("Location found", "Your current position is ready to use.");
        },
        error => {
            setStatus("Location unavailable", error.message, true);
        },
        { enableHighAccuracy: true, timeout: 15000 }
    );
});

// Enter key triggers route search.
[startInput, endInput].forEach(input => {
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") calculateRoute();
    });
});

// Load real road data when the page opens.
loadRoadNetwork().catch(error => {
    console.error(error);
    setStatus("Road data not loaded", error.message, true);
});
