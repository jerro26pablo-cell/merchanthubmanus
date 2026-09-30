export const philippineProvinces = [
  "Abra", "Agusan del Norte", "Agusan del Sur", "Aklan", "Albay", "Antique", "Apayao", "Aurora", "Basilan", "Bataan", "Batanes", "Batangas", "Benguet", "Biliran", "Bohol", "Bukidnon", "Bulacan", "Cagayan", "Camarines Norte", "Camarines Sur", "Camiguin", "Capiz", "Catanduanes", "Cavite", "Cebu", "Cotabato", "Davao de Oro", "Davao del Norte", "Davao del Sur", "Davao Occidental", "Davao Oriental", "Dinagat Islands", "Eastern Samar", "Guimaras", "Ifugao", "Ilocos Norte", "Ilocos Sur", "Iloilo", "Isabela", "Kalinga", "La Union", "Laguna", "Lanao del Norte", "Lanao del Sur", "Leyte", "Maguindanao del Norte", "Maguindanao del Sur", "Marinduque", "Masbate", "Misamis Occidental", "Misamis Oriental", "Mountain Province", "Negros Occidental", "Negros Oriental", "Northern Samar", "Nueva Ecija", "Nueva Vizcaya", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Pampanga", "Pangasinan", "Quezon", "Quirino", "Rizal", "Romblon", "Samar", "Sarangani", "Siquijor", "Sorsogon", "South Cotabato", "Southern Leyte", "Sultan Kudarat", "Sulu", "Surigao del Norte", "Surigao del Sur", "Tarlac", "Tawi-Tawi", "Zambales", "Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay",
] as const;

export const municipalitiesByProvince: Record<string, string[]> = {
  "South Cotabato": ["Polomolok", "General Santos City", "Koronadal City", "Tupi", "Lake Sebu", "Surallah", "Banga", "Norala", "Tantangan", "Tampakan", "Santo Niño"],
  "Cebu": ["Cebu City", "Lapu-Lapu City", "Mandaue City", "Talisay City", "Danao City", "Naga City", "Carcar City", "Consolacion"],
  "Davao del Sur": ["Davao City", "Digos City", "Bansalan", "Magsaysay", "Matanao", "Padada", "Santa Cruz"],
  "Davao del Norte": ["Tagum City", "Panabo City", "Island Garden City of Samal", "Carmen", "Kapalong", "New Corella"],
  "Metro Manila": ["Manila", "Quezon City", "Makati", "Pasig", "Taguig", "Pasay", "Mandaluyong", "Caloocan"],
  "Batangas": ["Batangas City", "Lipa City", "Tanauan City", "Santo Tomas", "Nasugbu", "Calaca", "Lemery"],
  "Cavite": ["Bacoor", "Imus", "Dasmariñas", "General Trias", "Cavite City", "Tagaytay", "Silang"],
  "Laguna": ["Santa Rosa", "Calamba", "Biñan", "San Pedro", "Cabuyao", "Los Baños", "Pagsanjan"],
  "Bulacan": ["Malolos", "Meycauayan", "San Jose del Monte", "Baliwag", "Bocaue", "Plaridel"],
  "Pampanga": ["San Fernando", "Angeles City", "Mabalacat", "Mexico", "Guagua", "Porac"],
  "Palawan": ["Puerto Princesa", "El Nido", "Coron", "Roxas", "Narra", "Brooke's Point"],
  "Iloilo": ["Iloilo City", "Passi City", "Pavia", "Oton", "Santa Barbara", "Pototan"],
  "Negros Occidental": ["Bacolod City", "Bago City", "Silay City", "Talisay City", "Kabankalan", "San Carlos"],
  "Misamis Oriental": ["Cagayan de Oro", "Gingoog", "El Salvador", "Jasaan", "Tagoloan"],
  "Pangasinan": ["Dagupan", "San Carlos", "Urdaneta", "Alaminos", "Lingayen", "Rosales"],
};

export const municipalitiesFor = (province: string) => municipalitiesByProvince[province] ?? ["Municipality / City", "Provincial capital", "Other municipality"];
