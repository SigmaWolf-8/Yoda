use yoda_memory::*;
use std::sync::Arc;

// ── Trit core ──────────────────────────────────────────────────────

#[test]
fn trit_from_char_ascii() {
    let t = TritSeq::from_char('A');
    assert_eq!(t.to_hash_string(), "2102");
}

#[test]
fn trit_from_char_zero() {
    let t = TritSeq::from_char('\0');
    assert_eq!(t.to_hash_string(), "0");
}

#[test]
fn trit_add_simple() {
    let one = TritSeq(Box::new([Trit::One]));
    let two = TritSeq(Box::new([Trit::Two]));
    let sum = TritSeq::add(&one, &two);
    assert_eq!(sum.to_hash_string(), "10");
}

#[test]
fn trit_add_carry() {
    let two = TritSeq(Box::new([Trit::Two]));
    let sum = TritSeq::add(&two, &two);
    assert_eq!(sum.to_hash_string(), "11");
}

#[test]
fn trit_ordering() {
    let a = TritSeq::from_char('A');
    let b = TritSeq::from_char('B');
    assert!(a < b);
}

#[test]
fn trit_base27_digits() {
    let t = TritSeq::from_char('A');
    let d = t.to_base27_digits();
    assert_eq!(d.len(), 2);
    assert_eq!(d[0], 2);
    assert_eq!(d[1], 11);
}

// ── Tree (Arc-based, Send + Sync) ──────────────────────────────────

#[test]
fn tree_insert_find() {
    let empty: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    let ka = IndexedTritSeq::from_char('a');
    let va = IndexedTritSeq::from_char('x');
    let tree = empty.insert(ka.clone(), va.clone());
    assert_eq!(tree.find(&ka).unwrap(), &va);
}

#[test]
fn tree_multiple_inserts() {
    let empty: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    let pairs: Vec<(char, char)> = vec![('a','x'), ('b','y'), ('c','z'), ('d','w')];
    let mut tree = empty;
    for &(k, v) in &pairs {
        tree = tree.insert(IndexedTritSeq::from_char(k), IndexedTritSeq::from_char(v));
    }
    for &(k, v) in &pairs {
        let found = tree.find(&IndexedTritSeq::from_char(k)).unwrap();
        assert_eq!(found, &IndexedTritSeq::from_char(v));
    }
}

#[test]
fn tree_snapshot_isolation() {
    // Persistent: writes to root_v2 must not be visible in root_v1.
    let empty: Arc<Tree<IndexedTritSeq, IndexedTritSeq>> = Tree::empty();
    let k1 = IndexedTritSeq::from_char('a');
    let v1 = IndexedTritSeq::from_char('1');
    let k2 = IndexedTritSeq::from_char('b');
    let v2 = IndexedTritSeq::from_char('2');

    let root_v1 = empty.insert(k1.clone(), v1.clone());
    let root_v2 = root_v1.insert(k2.clone(), v2.clone());

    assert!(root_v1.find(&k2).is_none());          // snapshot v1: no 'b'
    assert_eq!(root_v2.find(&k2).unwrap(), &v2);   // snapshot v2: has 'b'
    assert_eq!(root_v1.find(&k1).unwrap(), &v1);   // v1 still queryable
}

#[test]
fn tree_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Arc<Tree<IndexedTritSeq, IndexedTritSeq>>>();
}

// ── Isomorphic ─────────────────────────────────────────────────────

#[test]
fn isomorphic_true() {
    assert!(is_isomorphic_immutable("egg", "add"));
}

#[test]
fn isomorphic_false() {
    assert!(!is_isomorphic_immutable("foo", "bar"));
}

#[test]
fn isomorphic_unicode() {
    assert!(is_isomorphic_immutable("αβα", "γδγ"));
}

#[test]
fn isomorphic_empty() {
    assert!(is_isomorphic_immutable("", ""));
}

#[test]
fn isomorphic_length_mismatch() {
    assert!(!is_isomorphic_immutable("ab", "abc"));
}

// ── Cascade layers ─────────────────────────────────────────────────

#[test]
fn layer1_lexicographic() {
    let idx = IndexedTritSeq::from_char('A');
    assert_eq!(idx.lexicographic(), "2102");
}

#[test]
fn layer2_geometrical_bmp() {
    let idx = IndexedTritSeq::from_char('A');
    let geo = idx.geometrical().unwrap();
    assert_eq!(geo.len(), 3);
    assert_eq!(geo[0].to_hash_string(), "0");
    assert_eq!(geo[1].to_hash_string(), "0");
    assert_eq!(geo[2].to_hash_string(), "2102");
}

#[test]
fn layer2_geometrical_supplementary() {
    let idx = IndexedTritSeq::from_char('𐀀');
    let geo = idx.geometrical().unwrap();
    assert_eq!(geo[0].to_hash_string(), "1");
    assert_eq!(geo[1].to_hash_string(), "0");
    assert_eq!(geo[2].to_hash_string(), "0");
}

#[test]
fn layer3_algebraic() {
    let idx = IndexedTritSeq::from_char('B');
    assert_eq!(idx.algebraic().to_hash_string(), "2110");
}

#[test]
fn layer4_milesian() {
    let idx = IndexedTritSeq::from_char('A');
    assert_eq!(idx.milesian_value().to_hash_string(), "100");
}

#[test]
fn layer5_historical_enriched() {
    let idx = IndexedTritSeq::from_char('Σ')
        .with_historical_figure(3, 1);
    let (gen, pos) = idx.historical_figure().unwrap();
    assert_eq!(gen.to_hash_string(), "10");
    assert_eq!(pos.to_hash_string(), "1");
}

#[test]
fn layer6_element_enriched() {
    let idx = IndexedTritSeq::from_char('O').with_element(8);
    assert_eq!(idx.chemical_element().unwrap().to_hash_string(), "22");
}

#[test]
fn layer7_marker_record() {
    let idx = IndexedTritSeq::from_char('A');
    assert_eq!(idx.marker_record(), "U+0041");
}

#[test]
fn layer9_oracle() {
    let idx = IndexedTritSeq::from_char('A');
    assert_eq!(idx.alphabetical_oracle(), "P0R0C65");
}

#[test]
fn enrichment_affects_ordering() {
    let a = IndexedTritSeq::from_char('A');
    let b = IndexedTritSeq::from_char('A').with_manifold_u32(&[1]);
    assert!(a < b);
}

#[test]
fn ord_is_total_across_partial_enrichment() {
    // Layers 5 and 6 (historical_figure, chemical_element) are Option-typed.
    // The comparator must remain a total order even when only one side has
    // them set, otherwise the AVL tree breaks.  Convention: None < Some.
    let bare    = IndexedTritSeq::from_char('A');
    let with_hf = IndexedTritSeq::from_char('A').with_historical_figure(1, 1);
    let with_el = IndexedTritSeq::from_char('A').with_element(8);

    // None < Some on first optional layer (historical_figure)
    assert!(bare < with_hf);
    assert!(with_hf > bare);

    // Bare < element-only: historical_figure equal (both None), element layer
    // differs (None < Some).
    assert!(bare < with_el);

    // Transitivity check: bare < with_el < with_hf (with_hf wins at layer 5)
    assert!(bare < with_el);
    assert!(with_el < with_hf);
    assert!(bare < with_hf);

    // Antisymmetry: cmp is the inverse in the other direction
    assert_eq!(bare.cmp(&with_hf), std::cmp::Ordering::Less);
    assert_eq!(with_hf.cmp(&bare), std::cmp::Ordering::Greater);
}

#[test]
fn avl_keys_survive_partial_enrichment() {
    // Put enriched + bare variants of the same char into one tree; both
    // must be retrievable.  This would silently lose entries if the
    // comparator were non-total.
    let empty: Arc<Tree<IndexedTritSeq, u32>> = Tree::empty();
    let bare    = IndexedTritSeq::from_char('A');
    let with_hf = IndexedTritSeq::from_char('A').with_historical_figure(1, 1);
    let with_el = IndexedTritSeq::from_char('A').with_element(8);

    let t = empty.insert(bare.clone(), 1)
                 .insert(with_hf.clone(), 2)
                 .insert(with_el.clone(), 3);

    assert_eq!(t.find(&bare),    Some(&1));
    assert_eq!(t.find(&with_hf), Some(&2));
    assert_eq!(t.find(&with_el), Some(&3));
}
