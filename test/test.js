import {Foundry} from '@adraffy/blocksmith';
import {serve, EZCCIP} from '@resolverworks/ezccip';
import assert from 'node:assert/strict';
import {permutations} from './utils.js';

const EXPECT = 69420n;

let foundry = await Foundry.launch();

let contract = await foundry.deploy({sol: `
	import {OffchainNext} from '@src/OffchainNext.sol';
	interface Chonk {
		function chonk() external returns (uint256);
		function chonk2() external returns (uint256);
	}
	contract Test is OffchainNext {
		string[] urls;
		function set_urls(string[] memory _urls) external {
			urls = _urls;
		}
		function f() external view returns (uint256) {
			offchainLookup(address(this), urls, abi.encodeCall(Chonk.chonk, ()), this.g.selector, '');
		}
		function g(bytes calldata response, bytes calldata) external view returns (uint256 answer) {
			answer = uint256(bytes32(response));
			if (answer == 0) offchainLookup(address(this), urls, abi.encodeCall(Chonk.chonk2, ()), this.g.selector, ''); 
			if (answer != ${EXPECT}) revert OffchainTryNext();
		}
	}
`});

let ezccip = new EZCCIP();
ezccip.register('chonk() returns (uint256)', () => [EXPECT]);
let ccip_ok = await serve(ezccip, {protocol: 'raw', log: false});
let ccip_signed = await serve(ezccip, {protocol: 'tor', log: false});

let ezccip_wrong = new EZCCIP();
ezccip_wrong.register('chonk() returns (uint256)', () => [EXPECT+1]);
let ccip_wrong = await serve(ezccip_wrong, {protocol: 'raw', log: false});

let ezccip_throw = new EZCCIP();
ezccip_throw.register('chonk() returns (uint256)', () => { throw new Error('wtf'); });
let ccip_err = await serve(ezccip_throw, {protocol: 'raw', log: false});

const URLS = [
	'https://ethereum.org/', // not a ccip server
	//'https://raffy.xyz/notfound', // 404
	ccip_signed.endpoint,    // wrong protocol
	ccip_wrong.endpoint,     // wrong answer
	ccip_err.endpoint,       // throws
	ccip_ok.endpoint         // correct
];

const stack = [];
foundry.provider.on('debug', x => {
	if (x.action === 'sendCcipReadFetchRequest') {
		let i = URLS.indexOf(x.urls[x.index]);
		stack.push(i < 0 ? '@' : i);
	}
});

console.log('Trying all permutations...');
for (let urls of permutations(URLS)) {
	stack.length = 0;
	await foundry.confirm(contract.set_urls(urls), {silent: true});
	assert.equal(await contract.f({enableCcipRead: true}), EXPECT);
	console.log(stack.length, stack.join(''));
}

// try a recursive example
let ezccip_recursive = new EZCCIP();
ezccip_recursive.register('chonk() returns (uint256)', () => [0]);
ezccip_recursive.register('chonk2() returns (uint256)', () => [EXPECT]);
let ccip_recursive = await serve(ezccip, {protocol: 'raw', log: false});
await foundry.confirm(contract.set_urls([ccip_err.endpoint, ccip_recursive.endpoint]));
assert.equal(await contract.f({enableCcipRead: true}), EXPECT);

foundry.shutdown();
ccip_ok.http.close();
ccip_err.http.close();
ccip_wrong.http.close();
ccip_signed.http.close();
ccip_recursive.http.close();
