export let agent = navigator.userAgent.toLowerCase();

export let isLargeScreen = (): boolean => window.innerWidth >= 1500;

export let isIPad = (): boolean => agent.includes('ipad');

export let isSafari = (): boolean => agent.includes('safari') && !agent.includes('chrome');

export let isEdge = (): boolean => agent.includes('edge/');

export let isMobile = (): boolean =>
    agent.includes('android') || agent.includes('iphone') || agent.includes('ipad');

export let isTablet = () => isMobile() && window.innerWidth >= 640;

export let isMacintoshFirefox = (): boolean => agent.includes('mac') && agent.includes('firefox');

export function iOSVersion(): number | undefined {
    let match = /os (\d+)_(\d+)_?(\d+?)/.exec(agent);

    if (match) {
        let version = [
            parseInt(match[1], 10),
            parseInt(match[2], 10),
            parseInt(match[3] || '0', 10)
        ];

        return parseFloat(version.join('.'));
    }
}

export function androidVersion(): number | undefined {
    let split = agent.split('android');

    if (split.length > 1) return parseFloat(split[1].split(';')[0]);
}

export let isAppleDevice = (): boolean => agent.startsWith('ip');

// Older mobile devices will default to non-centred camera mode
export function isOldAndroid(): boolean {
    let version = androidVersion();

    return !!version && version < 6;
}

export function isOldApple(): boolean {
    let version = iOSVersion();

    return !!version && version < 9;
}

export function supportsWebGl(): boolean {
    try {
        let canvas = document.createElement('canvas');

        return !!(!!window.WebGLRenderingContext && canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

export let useCenteredCamera = (): boolean => isOldAndroid() || isOldApple() || isIPad();
