[out:json][timeout:25];
(
  way["highway"]["name"~"Lamar|5th Street|6th Street|Cesar Chavez|Riverside|3rd Street|9th Street|10th Street|12th Street|15th Street|Toomey"](30.256,-97.764,30.282,-97.733);
  node["highway"="traffic_signals"](30.256,-97.764,30.282,-97.733);
  way["waterway"="stream"]["name"~"Shoal"](30.256,-97.764,30.282,-97.733);
  way["natural"="water"](30.256,-97.764,30.282,-97.733);
);
out geom;
