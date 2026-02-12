let brokerConnected = false;

export const setMqttBrokerConnected = (connected: boolean) => {
    brokerConnected = connected;
};

export const isMqttBrokerConnected = () => brokerConnected;

