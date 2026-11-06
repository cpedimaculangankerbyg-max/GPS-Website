
#include "crow.h"
#include <nlohmann/json.hpp>

#include <iostream>
#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <functional>
#include <limits>
#include <algorithm>

using json = nlohmann::json;
// Global CORS middleware.
struct CorsMiddleware {
    struct context {};

    void before_handle(
        crow::request& req,
        crow::response& res,
        context& ctx
    ) {}

    void after_handle(
        crow::request& req,
        crow::response& res,
        context& ctx
    ) {
        res.add_header("Access-Control-Allow-Origin", "*");
        res.add_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.add_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Accept, Authorization"
        );
    }
};

struct Edge {
    std::string to;
    double weight;
};

using Graph = std::unordered_map<std::string, std::vector<Edge>>;

// Add CORS headers so the website can communicate with the C++ server.
void addCorsHeaders(crow::response& res) {
    res.add_header("Access-Control-Allow-Origin", "*");
    res.add_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.add_header("Access-Control-Allow-Headers", "Content-Type");
}

// Dijkstra's shortest-path algorithm.
json findShortestPath(
    const json& graphData,
    const std::string& start,
    const std::string& destination
) {
    Graph graph;
    std::unordered_set<std::string> nodes;

    // Read graph nodes.
    for (const auto& node : graphData.at("nodes")) {
        nodes.insert(node.at("id").get<std::string>());
    }

    // Read graph edges.
    for (const auto& edge : graphData.at("edges")) {
        std::string from = edge.at("from").get<std::string>();
        std::string to = edge.at("to").get<std::string>();
        double weight = edge.at("weight").get<double>();

        if (weight < 0) {
            throw std::runtime_error("Negative edge weights are not supported.");
        }

        graph[from].push_back({to, weight});
    }

    // Check starting and destination nodes.
    if (!nodes.count(start) || !nodes.count(destination)) {
        throw std::runtime_error(
            "Starting location or destination does not exist in the road network."
        );
    }

    // Initialize distances.
    const double INF = std::numeric_limits<double>::infinity();

    std::unordered_map<std::string, double> distance;
    std::unordered_map<std::string, std::string> previous;

    for (const auto& node : nodes) {
        distance[node] = INF;
    }

    distance[start] = 0.0;

    using QueueItem = std::pair<double, std::string>;

    std::priority_queue<
        QueueItem,
        std::vector<QueueItem>,
        std::greater<QueueItem>
    > pq;

    pq.push({0.0, start});

    // Dijkstra algorithm.
    while (!pq.empty()) {
        auto [currentDistance, currentNode] = pq.top();
        pq.pop();

        if (currentDistance > distance[currentNode]) {
            continue;
        }

        if (currentNode == destination) {
            break;
        }

        for (const auto& edge : graph[currentNode]) {
            double newDistance = currentDistance + edge.weight;

            if (newDistance < distance[edge.to]) {
                distance[edge.to] = newDistance;
                previous[edge.to] = currentNode;

                pq.push({newDistance, edge.to});
            }
        }
    }

    // Check whether a route exists.
    if (distance[destination] == INF) {
        throw std::runtime_error("No route found between these locations.");
    }

    // Reconstruct shortest path.
    std::vector<std::string> path;

    std::string current = destination;

    while (current != start) {
        path.push_back(current);

        if (!previous.count(current)) {
            throw std::runtime_error("Unable to reconstruct the route.");
        }

        current = previous[current];
    }

    path.push_back(start);
    std::reverse(path.begin(), path.end());

    return {
        {"success", true},
        {"path", path},
        {"distance_km", distance[destination]}
    };
}

int main() {
    crow::App<CorsMiddleware> app;

    // Health check.
    CROW_ROUTE(app, "/api/health")
    ([]() {
        crow::response res(200, "Tiaong GPS C++ server is running!");
        addCorsHeaders(res);
        res.set_header("Content-Type", "text/plain");
        return res;
    });

    // Handle browser preflight requests.
    CROW_ROUTE(app, "/api/route")
    .methods("OPTIONS"_method)
    ([]() {
        crow::response res(204);
        addCorsHeaders(res);
        return res;
    });

    // Calculate the shortest route.
    CROW_ROUTE(app, "/api/route")
    .methods("POST"_method)
    ([](const crow::request& req) {
        crow::response res;

        try {
            json requestData = json::parse(req.body);

            json graphData = requestData.at("graph");

            std::string start =
                requestData.at("start").get<std::string>();

            std::string destination =
                requestData.at("destination").get<std::string>();

            json result = findShortestPath(
                graphData,
                start,
                destination
            );

            res.code = 200;
            res.body = result.dump();
        }
        catch (const std::exception& e) {
            res.code = 400;

            res.body = json{
                {"success", false},
                {"error", e.what()}
            }.dump();
        }

        addCorsHeaders(res);
        res.set_header("Content-Type", "application/json");

        return res;
    });

    std::cout << "====================================\n";
    std::cout << "     TIAONG GPS NAVIGATION SERVER\n";
    std::cout << "====================================\n";
    std::cout << "Server: http://localhost:18080\n";
    std::cout << "Status: Running\n";
    std::cout << "Press CTRL+C to stop the server.\n";

    app.port(18080).multithreaded().run();

    return 0;
}
