function main(params) {
    if (params.type && params.type == 'message') {
        console.log('Received message body: ', params.body);
        return {payload: ''}
    }
    console.log('No message');
    return Promise.reject('No message');
}
