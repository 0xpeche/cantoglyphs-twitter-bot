const { ethers, getDefaultProvider } = require('ethers');
const { currencies } = require('./currencies.js');
const abi = require('./abi.json');
const erc721abi = require('./erc721abi.json');
const Axios = require('axios')
const twit = require('twit');
const fs = require('fs')

require('dotenv').config()

const nftContract = process.env.NFT_CONTRACT;
const rpcUrl = process.env.RPC_URL;
const altoContract = process.env.ALTO_CONTRACT;

const twitterConfig = {
    consumer_key: process.env.CONSUMER_KEY,
    consumer_secret: process.env.CONSUMER_SECRET,
    access_token: process.env.ACCESS_TOKEN_KEY,
    access_token_secret: process.env.ACCESS_TOKEN_SECRET,
};

const T = new twit(twitterConfig);

const ipfsGateway = process.env.IPFS_GATEWAY

let lastTransactionHash;

async function downloadImage(url, filepath) {

    if (url.includes("ipfs://")) {
        url = url.replace("ipfs://", ipfsGateway)
    }

    const response = await Axios({
        url,
        method: 'GET',
        responseType: 'stream'
    });
    return new Promise((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filepath))
            .on('error', reject)
            .once('close', () => resolve(filepath));
    });
}

async function getTokenURI(tokenId, tokenContract) {
    const nft = new ethers.Contract(tokenContract, erc721abi, getDefaultProvider(rpcUrl));

    const uri = await nft.tokenURI(tokenId);

    return uri;

}

async function getTokenMetadata(uri) {

    if (uri.includes("ipfs://")) {
        uri = uri.replace("ipfs://", ipfsGateway)
    }

    const response = await Axios.get(uri)

    const metadata = await response.data;

    return metadata;
}

async function tweet(tokenId, tokenContract, totalPrice, currency, buyer, txHash) {

    let uri = await getTokenURI(tokenId, tokenContract)
    let metadata = await getTokenMetadata(uri)

    await downloadImage(metadata.image, 'image.png');

    var b64content = fs.readFileSync('image.png', { encoding: 'base64' })

    tweetText = `${metadata.name} #${tokenId} bought for ${totalPrice} ${currency.name} by ${buyer.substring(0, 8)} on @AltoMarket\n https://evm.explorer.canto.io/tx/${txHash}`

    console.log(tweetText)

    T.post('media/upload', { media_data: b64content }, function (err, data, response) {
        // now we can assign alt text to the media, for use by screen readers and
        // other text-based presentations and interpreters
        var mediaIdStr = data.media_id_string
        var altText = `${metadata.name} #${tokenId}`
        var meta_params = { media_id: mediaIdStr, alt_text: { text: altText } }
        T.post('media/metadata/create', meta_params, function (err, data, response) {
            if (!err) {
                // now we can reference the media and post a tweet (media will attach to the tweet)
                var params = { status: tweetText, media_ids: [mediaIdStr] }
                T.post('statuses/update', params, function (err, data, response) {
                })
            }
        })
    })
}


async function monitorContract() {
    const contract = new ethers.Contract(altoContract, abi, getDefaultProvider(rpcUrl));
    contract.on("AskFilled", (tokenContract, tokenId, buyer, finder, ask, event) => {

        if (event.transactionHash == lastTransactionHash) return;

        lastTransactionHash = event.transactionHash

        if (tokenContract == nftContract) {

            // Default to CANTO
            let currency = {
                name: 'CANTO',
                decimals: 18,
                threshold: 1,
            };

            if (ask.askCurrency in currencies) {
                currency = currencies[ask.askCurrency]
            }

            let totalPrice = ethers.utils.formatUnits(
                ask.askPrice,
                currency.decimals
            );

            tweet(
                tokenId, tokenContract, totalPrice, currency, buyer, event.transactionHash
            )

        }
    })

}


monitorContract();
