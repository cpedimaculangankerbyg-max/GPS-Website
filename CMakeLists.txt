
cmake_minimum_required(VERSION 3.20)

project(TiaongGPS LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Crow CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

add_executable(tiaong_gps_server
    backend/main.cpp
)

target_link_libraries(tiaong_gps_server
    PRIVATE
    Crow::Crow
    nlohmann_json::nlohmann_json
)
