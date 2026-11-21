//! `random.Random` de Python, au bit près (repris de web_conquete) : Mersenne Twister (MT19937), la graine
//! d'un entier ou d'un texte (SHA-512, comme `random.seed(str)`), et les tirages que le moteur emploie.
//! La même graine rend la même météo, les mêmes clients et les mêmes événements qu'avant le portage.

use sha2::{Digest, Sha512};

const N: usize = 624;
const M: usize = 397;

#[derive(Clone)]
pub struct Random {
    mt: [u32; N],
    idx: usize,
}

impl Random {
    /// `random.Random(graine)` d'un entier (son signe ne compte pas).
    pub fn new(graine: i64) -> Random {
        let a = graine.unsigned_abs();
        let cle: Vec<u32> = if a >> 32 != 0 { vec![a as u32, (a >> 32) as u32] } else { vec![a as u32] };
        Random::par_tableau(&cle)
    }

    /// `random.Random("texte")` : l'entier fait du texte suivi de son SHA-512.
    pub fn new_str(graine: &str) -> Random {
        let mut octets = graine.as_bytes().to_vec();
        octets.extend_from_slice(&Sha512::digest(graine.as_bytes()));
        // grand entier gros-boutiste → mots de 32 bits, du poids faible au poids fort
        let mut cle: Vec<u32> = octets.rchunks(4).map(|m| m.iter().fold(0u32, |a, &o| (a << 8) | o as u32)).collect();
        while cle.len() > 1 && *cle.last().unwrap() == 0 {
            cle.pop();
        }
        Random::par_tableau(&cle)
    }

    fn par_tableau(cle: &[u32]) -> Random {
        let mut mt = [0u32; N];
        mt[0] = 19650218;
        for i in 1..N {
            mt[i] = 1812433253u32.wrapping_mul(mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_add(i as u32);
        }
        let (mut i, mut j) = (1usize, 0usize);
        for _ in 0..N.max(cle.len()) {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1664525)).wrapping_add(cle[j]).wrapping_add(j as u32);
            i += 1;
            j += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
            if j >= cle.len() {
                j = 0;
            }
        }
        for _ in 0..N - 1 {
            mt[i] = (mt[i] ^ (mt[i - 1] ^ (mt[i - 1] >> 30)).wrapping_mul(1566083941)).wrapping_sub(i as u32);
            i += 1;
            if i >= N {
                mt[0] = mt[N - 1];
                i = 1;
            }
        }
        mt[0] = 0x80000000;
        Random { mt, idx: N }
    }

    fn u32(&mut self) -> u32 {
        if self.idx >= N {
            let mt = &mut self.mt;
            for k in 0..N {
                let y = (mt[k] & 0x80000000) | (mt[(k + 1) % N] & 0x7fffffff);
                mt[k] = mt[(k + M) % N] ^ (y >> 1) ^ if y & 1 != 0 { 0x9908b0df } else { 0 };
            }
            self.idx = 0;
        }
        let mut y = self.mt[self.idx];
        self.idx += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^ (y >> 18)
    }

    /// `rng.random()` : dans [0, 1[.
    pub fn random(&mut self) -> f64 {
        let (a, b) = ((self.u32() >> 5) as f64, (self.u32() >> 6) as f64);
        (a * 67108864.0 + b) * (1.0 / 9007199254740992.0)
    }

    /// `rng.uniform(a, b)`.
    pub fn uniform(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.random()
    }

    /// `rng._randbelow(n)` : un entier de [0, n[.
    fn sous(&mut self, n: i64) -> i64 {
        assert!(n > 0, "ValueError: empty range for randrange()");
        let k = 64 - (n as u64).leading_zeros();
        loop {
            let r = if k <= 32 {
                (self.u32() >> (32 - k)) as u64
            } else {
                let bas = self.u32() as u64;
                bas | (((self.u32() >> (64 - k)) as u64) << 32)
            };
            if r < n as u64 {
                return r as i64;
            }
        }
    }

    /// `rng.randrange(n)`.
    pub fn randrange(&mut self, n: i64) -> i64 {
        self.sous(n)
    }

    /// `rng.randrange(a, b, pas)` (pas positif).
    pub fn randrange_pas(&mut self, a: i64, b: i64, pas: i64) -> i64 {
        a + pas * self.sous((b - a + pas - 1) / pas)
    }

    /// `rng.randint(a, b)` : dans [a, b].
    pub fn randint(&mut self, a: i64, b: i64) -> i64 {
        a + self.sous(b - a + 1)
    }

    /// `rng.choice(seq)` : le rang tiré dans une suite de n éléments.
    pub fn choice_i(&mut self, n: usize) -> usize {
        assert!(n > 0, "IndexError: Cannot choose from an empty sequence");
        self.sous(n as i64) as usize
    }

    /// `rng.choices(population, weights=poids, k=k)` : les rangs tirés.
    pub fn choices_w(&mut self, poids: &[f64], k: usize) -> Vec<usize> {
        let mut cumul = Vec::with_capacity(poids.len());
        let mut s = 0.0;
        for (i, p) in poids.iter().enumerate() {
            s = if i == 0 { *p } else { s + p };
            cumul.push(s);
        }
        let total = *cumul.last().expect("IndexError: choices sans population") + 0.0;
        assert!(total > 0.0, "ValueError: Total of weights must be greater than zero");
        let hi = poids.len() - 1;
        (0..k)
            .map(|_| {
                let x = self.random() * total;
                // bisect_right(cumul, x, 0, hi)
                let (mut lo, mut h) = (0usize, hi);
                while lo < h {
                    let mid = (lo + h) / 2;
                    if x < cumul[mid] {
                        h = mid
                    } else {
                        lo = mid + 1
                    }
                }
                lo
            })
            .collect()
    }
}

/// `random.randrange(...)` du module (dé non rejouable) : une graine neuve.
pub fn graine_hasard() -> i64 {
    use std::hash::{BuildHasher, Hasher};
    // RandomState tire ses clés du système à chaque processus : c'est le hasard de la bibliothèque standard
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    (h.finish() >> 2) as i64
}

#[cfg(test)]
mod essais {
    use super::*;

    #[test]
    fn comme_python() {
        // valeurs de Python 3 : random.Random(42).random(), random.Random("abc").random()
        assert_eq!(Random::new(42).random(), 0.6394267984578837);
        assert_eq!(Random::new_str("abc").random(), 0.7720246314157545);
        let mut r = Random::new(1);
        assert_eq!((0..5).map(|_| r.randint(-3, 3)).collect::<Vec<_>>(), vec![-2, 1, 3, 3, 3]);
        let mut r = Random::new(7);
        assert_eq!(r.randrange_pas(300, 750, 50), 550);
        assert_eq!(r.choices_w(&[1.0, 2.0, 3.0], 1)[0], 2);
    }
}
