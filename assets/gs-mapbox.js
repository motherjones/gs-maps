// https://account.mapbox.com/access-tokens/
mapboxgl.accessToken = 'pk.eyJ1IjoibW90aGVyam9uZXMiLCJhIjoiY2p2emw3Nzc4MDFpZTQzcGllZzR5c2hmNCJ9.tG_ytBv6NrTA1IR9R_chmA'; 

// add a new mapbox base layer
let map = new mapboxgl.Map({
	container: 'map', // container id
	style: 'mapbox://styles/motherjones/ckexnp9g50cyl19n19cs3ncd7', // mapbox studio
	center: coords, // starting position [lng, lat]
	minZoom: 10.5,
	maxZoom: 16
});

// fetch the demographic data separately so you can access it outside of mapbox
// then use it to create the map
fetch(data_census)
	.then(res => res.json())
	.then(createMap)
	.catch(e => console.error(e));

function createMap(census_tracts) {
	// calculate % white for each census tract
	const values = census_tracts.features.map(function(d){
		const white = d.properties.B03002003;
		const total = d.properties.B03002001;
		let percentage = white/total;
		return percentage;
	})

	// generate a gradient scale for for the choropleth 
	// skip NaN values from divide-by-zero errors
	const scale = [
		Math.min.apply(null, values.filter(function(n) { return !isNaN(n); })),
		'#cc5400',
		Math.max.apply(null, values.filter(function(n) { return !isNaN(n); })),
		'#ffd34f'
	]

	// update legend labels based on new scale values
	const legend = document.getElementById('demo');
	const left = legend.querySelector('.left');
	const right = legend.querySelector('.right');

	left.textContent = (scale[0]*100).toFixed(1);
	right.textContent = (scale[2]*100).toFixed(1);

	// after the map is loaded, add our custom layers
	map.on('load', function() {

		// add the source for census tract demographics to mapbox
		map.addSource('tracts', {
			'type': 'geojson',
			'data': census_tracts //result of fetch
		});

		const layers = map.getStyle().layers;
		const target_layer_tracts = layers[4].id; // place choropleth below street layer and labels
		const target_layer_schools = layers[42].id; // place points below city name labels

		// add the census tract layer to the map
		map.addLayer({
			'id': 'tracts',
			'type': 'fill',
			'source': 'tracts',
			'layout': {},
			'paint': {
				'fill-color':  
					[
						'interpolate',
						['linear'],
						['/', ['get', 'B03002003'], ['get', 'B03002001']],
						...scale
					],
				'fill-opacity': 1,
				'fill-outline-color': '#fff'
			}
		}, target_layer_tracts);

		// save this data to use in popups
		let polygon_data = '';
		map.on('click', 'tracts', function(e) {
			polygon_data = e.features[0].properties;
		});

		// save boundaries for resize events
		let bounds = new mapboxgl.LngLatBounds();

		// fetch the school data, then add it to the map
		fetch(data_schools)
			.then(res => res.json())
			.then(addSchools)
			.catch(e => console.error(e));

		function addSchools(schools) {

			map.addSource('schools', {
				'type': 'geojson',
				'data': schools // result of fetch
			});
			const filter_group = document.getElementById('filter-group'); // part of legend/key

			// loop through schools and add layers
			schools.features.forEach(function(feature) {
				// zoom map to markers
				bounds.extend(feature.geometry.coordinates);
				setBounds();

				let rating = feature.properties[rating_prop];
				let layerID = 'rated-' + rating;
				 
				// add a layer for each individual symbol type (rating) if it hasn't been added already
				if (!map.getLayer(layerID)) {
					map.addLayer({
						'id': layerID,
						'type': 'circle',
						'source': 'schools',
						'paint': {
							// make circles larger as user zooms from z10 to z12
							'circle-radius': {
								'stops': [
									[10, 4],
									[11, 8],
									[12, 16]
								]
							},
							// color circles by score, using a match expression
							// https://docs.mapbox.com/mapbox-gl-js/style-spec/#expressions-match
							// colors via https://colorbrewer2.org/#type=sequential&scheme=YlGn&n=9
							'circle-color': [
								'match',
								rating.toString(),
								'9',
								'#022951',
								'8',
								'#2f4375',
								'7',
								'#325390',
								'6',
								'#516aa8',
								'5',
								'#5a80aa',
								'4',
								'#8397ca',
								'3',
								'#96b1d4',
								'2',
								'#d8d2e5',
								'1',
								'#fff',
								'#ddd' // other
							],
						    'circle-stroke-width': 1.25,
						    'circle-stroke-color': '#000'
						},
						'filter': ['==', rating_prop, rating] //assigns filter value for controls
					}, target_layer_schools);
					 
					// build filter controls in the legend for this layer
					// checkbox first
					let input = document.createElement('input');
					input.type = 'checkbox';
					input.id = layerID;
					input.checked = true;
					filter_group.appendChild(input);
					 
					// label with color key second
					let label = document.createElement('label');
					let color_key = document.createElement('span');
					color_key.classList.add('color-key');
					color_key.classList.add(layerID);
					label.setAttribute('for', layerID);
					label.textContent = rating;
					filter_group.appendChild(label);
					label.prepend(color_key);
					 
					// when the checkbox changes, update the visibility of this layer
					input.addEventListener('change', function(e) {
						map.setLayoutProperty(
							layerID,
							'visibility',
							e.target.checked ? 'visible' : 'none'
						);
					});

					// add a mapbox popup for points in this layer
					let popup = new mapboxgl.Popup();
					handlePopup(layerID, popup);

					// add hover states for points in this layer
					handleMouseEnter(layerID);
					handleMouseLeave(layerID);
				}


			});
			

			function handlePopup(layerID, popup) {
				// when a click event occurs on a feature (school) in the schools layer, open a popup at the
				// location of the feature and add description HTML from the clicked feature's properties
				map.on('click', layerID, function(e) {
					let coordinates = e.features[0].geometry.coordinates.slice();
					let rating = e.features[0].properties[rating_prop];
					let school_name = e.features[0].properties.school_name;

					// TODO: try this without string concatenation
					let description = '<div class="marker-pin rated-' + rating + '"><span>' + rating + '</span></div>';
					description += '<h2>' + school_name + '</h2>';
					description += '<p><strong>' + rating + '/10</strong> GreatSchools rating</p>';
					description += '<p>The surrounding area is <strong>' + (polygon_data.B03002003/polygon_data.B03002001*100).toFixed(1) + '%</strong> white.</p>';
					
					popup
						.setLngLat(coordinates) // set the location of the popup relative to the map
						.setHTML(description) // set the popup's content
						.addTo(map); // add the popup to the map
					
				});
			}

			function handleMouseEnter(layerID) {
				// change the cursor to a pointer when the mouse is over a school
				map.on('mouseenter', layerID, function() {
					map.getCanvas().style.cursor = 'pointer';
				});
			}

			function handleMouseLeave(layerID) {
				// change it back to the default cursor when the mouse isn't hovering anymore
				map.on('mouseleave', layerID, function() {
					map.getCanvas().style.cursor = '';
				});	
			}

			// make filters for groups of layers instead of individual ones		
			// these groups are arbitrary and you need to manually make HTML checkboxes and labels for them
			function manageMultiFilters(max) {
				let multifilterID = 'rated-' + (max-2) + '-' + max;
				document.getElementById(multifilterID).addEventListener('change', (e) => {
					let event = new Event('change');
					if (e.target.checked) {
						for (let i=max; i>(max-3); i--) {
							let layer = document.getElementById('rated-' + i); // original filter
							if (layer !== null) {
								layer.checked = true; // toggle it
								layer.dispatchEvent(event);
							}
						}
					} else {
						for (let i=max; i>(max-3); i--) {
							let layer = document.getElementById('rated-' + i); // original filter
							if (layer !== null) {
								layer.checked = false; // toggle it
								layer.dispatchEvent(event);
							}
						}
					}
				});
			}

			manageMultiFilters(9);
			manageMultiFilters(6);
			manageMultiFilters(3);

		} // end addSchools()

		function setBounds() {
			let padding = map_padding;
			let offset = map_offset;

			if (window.innerWidth < 769) {
				padding = 100;
				offset = [0,-50];
			}
			map.fitBounds(bounds, { 
				padding: padding,
				offset: offset
			});
		}

		window.onresize = function() {
			setBounds();	
		};

	});
}