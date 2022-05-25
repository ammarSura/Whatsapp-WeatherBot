const axios = require('axios');



const getCoordinates = async (query) => {
    const result = await axios.get('https://geocoding-api.open-meteo.com/v1/search?', {
            params: {
                name: query,
                count: '1'
            }
        });
    
        return result;

    };

const getWeather = async (latitude, longitude, current_weather, timezone) => {

    const weatherData = await axios.get('https://api.open-meteo.com/v1/forecast?', {
        params: {
            latitude: latitude,
            longitude: longitude,
            current_weather: current_weather ,
            timezone: timezone,
            daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
           
        }
    })
    return weatherData;

}

const getWeatherFromCityName = async (query) => {
    
    const coordResults = (await getCoordinates(query)).data.results;
    
    
    if (coordResults) {
        const city = coordResults[0];
        
        const weatherData = (await getWeather(city.latitude, city.longitude, true, city.timezone)).data;
        console.dir(weatherData)
        if (weatherData) {
            weatherData["cityName"] = city.name;
            return weatherData
        }
    } 

    return false;
    
}


module.exports = {
    getWeather, getCoordinates, getWeatherFromCityName
}




  