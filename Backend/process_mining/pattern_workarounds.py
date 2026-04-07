import os
import re
import pm4py
from enum import Enum
from pm4py.objects.process_tree.utils import generic as pt_util
from pm4py.objects.process_tree.utils.generic import tree_sort
from collections import defaultdict

try:
    from collections.abc import Iterable
except ImportError:
    from collections import Iterable


class Parameters(Enum):
    DEBUG = "debug"
    FOLD = "fold"


# ── Process tree utilities (needed for XOR extraction) ────────────────────────

def leafs(tree):
    """Return activity name strings for all leaf nodes of a process tree node."""
    activities = []
    if not len(tree._children) > 0:
        return None
    for child in range(len(tree._children)):
        if len(tree._children[child]._children) == 0:
            activities.append(str(tree._children[child]))
        else:
            sub = leafs(tree._children[child])
            if sub:
                activities.extend(sub)
    return activities


def flatten(lis):
    for item in lis:
        if isinstance(item, Iterable) and not isinstance(item, str):
            for x in flatten(item):
                yield x
        else:
            yield item


def relations(tree, parallels, exclusives):
    """Recursively collect AND (+) and XOR (X) groups from a process tree."""
    if not len(tree._children) > 0:
        return parallels, exclusives

    tree_operator = tree.operator
    leaf_list = leafs(tree)

    if str(tree_operator) == '+' and leaf_list and 'tau' not in str(leaf_list):
        key = ' and '.join(str(tree._children[q]) for q in range(len(tree._children)))
        parallels[key] = leaf_list

    if str(tree_operator) == 'X' and leaf_list and 'tau' not in str(leaf_list):
        key = ' and '.join(str(tree._children[q]) for q in range(len(tree._children)))
        exclusives[key] = leaf_list

    for child in range(len(tree._children)):
        parallels, exclusives = relations(tree._children[child], parallels, exclusives)
    return parallels, exclusives


def get_exclusives(net):
    """Extract mutually exclusive (XOR) activity groups from a Petri net.

    Converts the net to a process tree representation and collects all XOR blocks.
    Returns a dict {group_key: [act_name, ...]} for each XOR group found.
    Silent (tau) transitions are ignored.
    """
    parameters = {}
    try:
        grouped_net = pm4py.objects.conversion.wf_net.variants.to_process_tree.group_blocks_in_net(
            net, parameters=parameters
        )
    except Exception as e:
        print(f"[get_exclusives] Process tree conversion failed: {e}")
        return {}

    acts = set(t.label for t in net.transitions if t.label is not None)
    parallels = {}
    exclusives = {}

    for trans in grouped_net.transitions:
        if trans.label is not None and str(trans.label) not in acts:
            try:
                pt = pt_util.parse(str(trans.label))
                tree_part = pt_util.fold(pt)
                tree_sort(tree_part)
                parallels, exclusives = relations(tree_part, parallels, exclusives)
            except Exception:
                continue

    return exclusives


# ── Pattern detection functions ────────────────────────────────────────────────

def check_recurrence(trace_activities, act):
    """Check if act appears more than once in the trace (recurrence).

    Also detects the special case of direct consecutive repetition.

    Args:
        trace_activities: ordered list of activity names in the trace
        act: activity name to check

    Returns:
        (is_recurrent, is_direct_repeat): both bool
    """
    count = trace_activities.count(act)
    if count <= 1:
        return False, False

    is_direct = any(
        trace_activities[i] == act and trace_activities[i + 1] == act
        for i in range(len(trace_activities) - 1)
    )
    return True, is_direct


def check_mutually_exclusive(trace_activities, exclusives_dict):
    """Find pairs of mutually exclusive activities (from XOR blocks) that co-occur in the trace.

    Args:
        trace_activities: list of activity names in the trace
        exclusives_dict: {group_key: [act_name, ...]} from get_exclusives()

    Returns:
        list of (act_a, act_b) pairs that are exclusive but both present in the trace
    """
    trace_set = set(trace_activities)
    cooccurring = []
    seen = set()

    for leaf_list in exclusives_dict.values():
        for i, act_a in enumerate(leaf_list):
            if act_a not in trace_set:
                continue
            for act_b in leaf_list[i + 1:]:
                if act_b not in trace_set:
                    continue
                pair = tuple(sorted([act_a, act_b]))
                if pair not in seen:
                    seen.add(pair)
                    cooccurring.append((act_a, act_b))

    return cooccurring


def check_order(alignment, inserted_act, skipped_act):
    """Check whether an inserted and a skipped activity suggest a wrong-order deviation.

    A wrong-order pattern occurs when `inserted_act` appears as a log move (in log but not
    expected by model at that position) AND `skipped_act` appears as a model move (model
    expected it, but it was not executed there) in the same alignment.

    When inserted_act == skipped_act the activity was executed at the wrong position.
    When they differ, it suggests a swap where one activity replaced another.

    Args:
        alignment: list of (log_move, model_move) tuples from pm4py alignment
        inserted_act: activity name expected as a log move (model_move == '>>')
        skipped_act: activity name expected as a model move (log_move == '>>')

    Returns:
        bool: True if both moves are present in the alignment
    """
    has_insert = any(lm == inserted_act and mm == '>>' for lm, mm in alignment)
    has_skip = any(lm == '>>' and mm == skipped_act for lm, mm in alignment)
    return has_insert and has_skip


def _get_alignment_context_neighbors(alignment, act, is_skip=False):
    """Get the nearest visible activities before and after `act` in the alignment.

    For insertions (is_skip=False): look at positions where act is a log move.
    For skips (is_skip=True): look at positions where act is a model move.

    'Visible' means: sync move or log move (actually executed activity).

    Returns:
        list of neighboring activity names
    """
    if is_skip:
        positions = [j for j, (lm, mm) in enumerate(alignment) if lm == '>>' and mm == act]
    else:
        positions = [j for j, (lm, mm) in enumerate(alignment) if mm == '>>' and lm == act]

    neighbors = []
    for pos in positions:
        # Nearest preceding visible activity
        for k in range(pos - 1, -1, -1):
            lm, mm = alignment[k]
            if mm is not None and lm == mm and lm != '>>':  # sync move
                neighbors.append(lm)
                break
            elif mm == '>>' and lm not in (None, '>>'):     # log move
                neighbors.append(lm)
                break
        # Nearest following visible activity
        for k in range(pos + 1, len(alignment)):
            lm, mm = alignment[k]
            if mm is not None and lm == mm and lm != '>>':
                neighbors.append(lm)
                break
            elif mm == '>>' and lm not in (None, '>>'):
                neighbors.append(lm)
                break

    return neighbors


def occurrence_unusual_neighbour(log, act, deviating_trace_indices):
    """Identify activities that appear unusually often as neighbors of `act` in deviating traces.

    Compares neighbor frequency in deviating traces vs. all traces where `act` appears.
    A neighbor is 'unusual' if it is at least 50% more frequent in deviating traces and
    appears at least twice.

    Args:
        log: pm4py event log
        act: activity name to check neighbors for
        deviating_trace_indices: indices of traces where `act` is involved in a deviation

    Returns:
        list of (neighbor_act, dev_count, n_deviating) sorted by dev_count descending
    """
    if not deviating_trace_indices:
        return []

    deviating_set = set(deviating_trace_indices)
    all_neighbors = defaultdict(int)   # neighbor -> count across all traces where act appears
    dev_neighbors = defaultdict(int)   # neighbor -> count in deviating traces
    n_all_with_act = 0

    for i, trace in enumerate(log):
        activities = [event['concept:name'] for event in trace if 'concept:name' in event]
        if act not in activities:
            continue
        n_all_with_act += 1
        for j, a in enumerate(activities):
            if a != act:
                continue
            if j > 0:
                all_neighbors[activities[j - 1]] += 1
                if i in deviating_set:
                    dev_neighbors[activities[j - 1]] += 1
            if j < len(activities) - 1:
                all_neighbors[activities[j + 1]] += 1
                if i in deviating_set:
                    dev_neighbors[activities[j + 1]] += 1

    if n_all_with_act == 0:
        return []

    n_deviating = len(deviating_trace_indices)
    unusual = []
    for nb, dev_count in dev_neighbors.items():
        dev_freq = dev_count / n_deviating
        global_freq = all_neighbors[nb] / n_all_with_act
        if dev_freq > global_freq * 1.5 and dev_count >= 2:
            unusual.append((nb, dev_count, n_deviating))

    return sorted(unusual, key=lambda x: -x[1])


# ── Cross-issue merge suggestions ─────────────────────────────────────────────

def get_merge_suggestions(aligned_traces, stored_issue_map):
    """Detect pairs of DIFFERENT issues that may represent the same underlying deviation.

    Currently detects wrong-order cross-issue pairs: if Issue A contains (Insert X) and
    Issue B contains (Skip X) for the same activity X, and both deviations co-occur in many
    traces, they likely represent a single wrong-order event and would benefit from merging.

    Args:
        aligned_traces: list of alignment dicts (each with 'alignment' key)
        stored_issue_map: {original_col: issue_name}

    Returns:
        list of suggestion dicts sorted by support_pct descending:
            issue_a, issue_b, pattern_type, activity,
            description, support_count, total_traces, support_pct
    """
    act_insert_issues = defaultdict(set)  # activity → issue names where it's inserted
    act_skip_issues = defaultdict(set)    # activity → issue names where it's skipped

    for col, issue_name in stored_issue_map.items():
        m_ins = re.match(r'^\(Insert (.+)\)$', col)
        m_skip = re.match(r'^\(Skip (.+)\)$', col)
        if m_ins:
            act_insert_issues[m_ins.group(1)].add(issue_name)
        elif m_skip:
            act_skip_issues[m_skip.group(1)].add(issue_name)

    total_traces = len(aligned_traces)
    suggestions = []
    seen_pairs = set()

    for act in set(act_insert_issues.keys()) & set(act_skip_issues.keys()):
        for issue_a in act_insert_issues[act]:
            for issue_b in act_skip_issues[act]:
                if issue_a == issue_b:
                    continue  # same issue already handles this internally
                pair_key = tuple(sorted([issue_a, issue_b]))
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                cooccur_count = sum(
                    1 for ad in aligned_traces
                    if (any(lm == act and mm == '>>' for lm, mm in ad['alignment']) and
                        any(lm == '>>' and mm == act for lm, mm in ad['alignment']))
                )

                if cooccur_count > 0:
                    pct = round(100 * cooccur_count / total_traces, 1) if total_traces else 0.0
                    suggestions.append({
                        'issue_a': issue_a,
                        'issue_b': issue_b,
                        'pattern_type': 'wrong_order',
                        'activity': act,
                        'description': (
                            f'"{act}" is inserted in "{issue_a}" but skipped in "{issue_b}" '
                            f'in {cooccur_count}/{total_traces} traces ({pct}%) — '
                            f'these may represent the same wrong-order deviation'
                        ),
                        'support_count': cooccur_count,
                        'total_traces': total_traces,
                        'support_pct': pct,
                    })

    suggestions.sort(key=lambda x: -x['support_pct'])
    return suggestions


# ── Main analysis function ─────────────────────────────────────────────────────

def get_workaround_patterns(log, aligned_traces, stored_issue_map, bpmn_path=None):
    """Analyze each merged issue for potential workaround patterns.

    For each issue and each activity within it:
    - Inserted activities: recurrence, direct_repetition, mutually_exclusive, unusual_neighbor
    - Skipped activities: missing_occurrence, unusual_neighbor
    - Same activity both inserted + skipped in one issue: wrong_order (executed at wrong position)
    - Different activities (one inserted, one skipped) in same issue: wrong_order (possible swap)

    All patterns include a support count and percentage relative to the number of deviating
    traces for that issue.

    Args:
        log: pm4py event log (EventLog object)
        aligned_traces: list of alignment dicts (each has an 'alignment' key with list of
                        (log_move, model_move) tuples)
        stored_issue_map: dict {original_col: issue_name}
                          e.g. {"(Insert A)": "Issue 1", "(Skip B)": "Issue 1"}
        bpmn_path: optional path to BPMN or PNML file; used to extract XOR structure for
                   the mutually_exclusive pattern

    Returns:
        dict {issue_name: [pattern_dict, ...]} where each pattern_dict contains:
            pattern_type, activity, description, support_count, total_deviating, support_pct
            and optional type-specific fields (exclusive_partokener, swap_partner, unusual_neighbors)
    """
    # Parse issue map into {issue_name: [(dev_type, activity), ...]}
    issue_to_devs = defaultdict(list)
    for col, issue_name in stored_issue_map.items():
        m_ins = re.match(r'^\(Insert (.+)\)$', col)
        m_skip = re.match(r'^\(Skip (.+)\)$', col)
        if m_ins:
            issue_to_devs[issue_name].append(('insert', m_ins.group(1)))
        elif m_skip:
            issue_to_devs[issue_name].append(('skip', m_skip.group(1)))

    # Extract XOR structure from BPMN/PNML if available
    exclusives_dict = {}
    if bpmn_path and os.path.exists(bpmn_path):
        try:
            ext = os.path.splitext(bpmn_path)[1].lower()
            if ext == '.pnml':
                net, _im, _fm = pm4py.read_pnml(bpmn_path)
            else:
                net, _im, _fm = pm4py.convert.convert_to_petri_net(pm4py.read_bpmn(bpmn_path))
            exclusives_dict = get_exclusives(net)
            print(f"[workaround_patterns] Extracted {len(exclusives_dict)} XOR group(s)")
        except Exception as e:
            print(f"[workaround_patterns] Could not extract XOR structure: {e}")

    result = {}

    for issue_name, devs in issue_to_devs.items():
        inserted_acts = {act for dev_type, act in devs if dev_type == 'insert'}
        skipped_acts = {act for dev_type, act in devs if dev_type == 'skip'}

        # Traces that have at least one deviation belonging to this issue
        issue_trace_indices = []
        for i, alignment_data in enumerate(aligned_traces):
            alignment = alignment_data['alignment']
            for lm, mm in alignment:
                if mm == '>>' and lm in inserted_acts:
                    issue_trace_indices.append(i)
                    break
                if lm == '>>' and mm in skipped_acts:
                    issue_trace_indices.append(i)
                    break

        n_deviating = len(issue_trace_indices)
        if n_deviating == 0:
            result[issue_name] = []
            continue

        patterns = []
        seen_patterns = set()  # deduplicate symmetric pairs

        # ── Inserted activities ──────────────────────────────────────────────
        for act in inserted_acts:
            act_trace_indices = [
                i for i in issue_trace_indices
                if any(lm == act and mm == '>>' for lm, mm in aligned_traces[i]['alignment'])
            ]
            n_act = len(act_trace_indices)
            if n_act == 0:
                continue

            # 1. Recurrence & direct repetition
            recur_count = 0
            direct_rep_count = 0
            for i in act_trace_indices:
                trace_acts = [event['concept:name'] for event in log[i] if 'concept:name' in event]
                is_rec, is_dir = check_recurrence(trace_acts, act)
                if is_rec:
                    recur_count += 1
                if is_dir:
                    direct_rep_count += 1

            if recur_count > 0:
                patterns.append({
                    'pattern_type': 'recurrence',
                    'activity': act,
                    'description': (
                        f'"{act}" appears more than once in the trace (recurrence) in '
                        f'{recur_count}/{n_deviating} deviating traces ({100*recur_count/n_deviating:.1f}%)'
                    ),
                    'support_count': recur_count,
                    'total_deviating': n_deviating,
                    'support_pct': round(100 * recur_count / n_deviating, 1),
                })

            if direct_rep_count > 0:
                patterns.append({
                    'pattern_type': 'direct_repetition',
                    'activity': act,
                    'description': (
                        f'"{act}" is executed in direct consecutive repetition in '
                        f'{direct_rep_count}/{n_deviating} deviating traces ({100*direct_rep_count/n_deviating:.1f}%)'
                    ),
                    'support_count': direct_rep_count,
                    'total_deviating': n_deviating,
                    'support_pct': round(100 * direct_rep_count / n_deviating, 1),
                })

            # 2. Mutually exclusive co-occurrence
            if exclusives_dict:
                exclusive_partners = set()
                for leaf_list in exclusives_dict.values():
                    if act in leaf_list:
                        exclusive_partners.update(a for a in leaf_list if a != act)

                for partner in exclusive_partners:
                    dedup_key = tuple(sorted(['mutually_exclusive', act, partner]))
                    if dedup_key in seen_patterns:
                        continue
                    cooccur_count = sum(
                        1 for i in act_trace_indices
                        if partner in {event['concept:name'] for event in log[i]
                                       if 'concept:name' in event}
                    )
                    if cooccur_count > 0:
                        seen_patterns.add(dedup_key)
                        patterns.append({
                            'pattern_type': 'mutually_exclusive',
                            'activity': act,
                            'description': (
                                f'"{act}" and "{partner}" are mutually exclusive in the model '
                                f'but both occur in {cooccur_count}/{n_deviating} deviating traces '
                                f'({100*cooccur_count/n_deviating:.1f}%)'
                            ),
                            'support_count': cooccur_count,
                            'total_deviating': n_deviating,
                            'support_pct': round(100 * cooccur_count / n_deviating, 1),
                            'exclusive_partner': partner,
                        })

            # 3. Wrong order
            # Case A: same activity is both inserted and skipped in this issue
            if act in skipped_acts:
                order_count = sum(
                    1 for i in act_trace_indices
                    if check_order(aligned_traces[i]['alignment'], act, act)
                )
                if order_count > 0:
                    patterns.append({
                        'pattern_type': 'wrong_order',
                        'activity': act,
                        'description': (
                            f'"{act}" is both inserted and skipped in the same trace in '
                            f'{order_count}/{n_deviating} deviating traces ({100*order_count/n_deviating:.1f}%), '
                            f'suggesting it was executed at the wrong position'
                        ),
                        'support_count': order_count,
                        'total_deviating': n_deviating,
                        'support_pct': round(100 * order_count / n_deviating, 1),
                    })
            else:
                # Case B: different activity inserted while another is skipped
                for skip_act in skipped_acts:
                    dedup_key = ('wrong_order_swap', act, skip_act)
                    if dedup_key in seen_patterns:
                        continue
                    order_count = sum(
                        1 for i in act_trace_indices
                        if check_order(aligned_traces[i]['alignment'], act, skip_act)
                    )
                    if order_count > 0:
                        seen_patterns.add(dedup_key)
                        patterns.append({
                            'pattern_type': 'wrong_order',
                            'activity': act,
                            'description': (
                                f'"{act}" is inserted while "{skip_act}" is skipped in '
                                f'{order_count}/{n_deviating} deviating traces ({100*order_count/n_deviating:.1f}%), '
                                f'suggesting activities were executed in the wrong order'
                            ),
                            'support_count': order_count,
                            'total_deviating': n_deviating,
                            'support_pct': round(100 * order_count / n_deviating, 1),
                            'swap_partner': skip_act,
                        })

            # 4. Unusual neighbor (uses actual trace sequence for inserted activities)
            unusual_nbs = occurrence_unusual_neighbour(log, act, act_trace_indices)
            if unusual_nbs:
                nb_names = [nb for nb, _, _ in unusual_nbs[:3]]
                top_support = unusual_nbs[0][1]
                patterns.append({
                    'pattern_type': 'unusual_neighbor',
                    'activity': act,
                    'description': (
                        f'Traces where "{act}" is inserted show unusual neighboring activities '
                        f'({", ".join(nb_names)}) in {top_support}/{n_deviating} deviating traces '
                        f'({100*top_support/n_deviating:.1f}%)'
                    ),
                    'support_count': top_support,
                    'total_deviating': n_deviating,
                    'support_pct': round(100 * top_support / n_deviating, 1),
                    'unusual_neighbors': nb_names,
                })

        # ── Skipped activities ───────────────────────────────────────────────
        for act in skipped_acts:
            act_trace_indices = [
                i for i in issue_trace_indices
                if any(lm == '>>' and mm == act for lm, mm in aligned_traces[i]['alignment'])
            ]
            n_act = len(act_trace_indices)
            if n_act == 0:
                continue

            # 5. Missing occurrence (always applicable for skips)
            patterns.append({
                'pattern_type': 'missing_occurrence',
                'activity': act,
                'description': (
                    f'"{act}" is skipped (missing occurrence) in '
                    f'{n_act}/{n_deviating} deviating traces ({100*n_act/n_deviating:.1f}%)'
                ),
                'support_count': n_act,
                'total_deviating': n_deviating,
                'support_pct': round(100 * n_act / n_deviating, 1),
            })

            # 6. Wrong order: skip + insert of different activity (if not handled above)
            if act not in inserted_acts:
                for ins_act in inserted_acts:
                    dedup_key = ('wrong_order_swap', ins_act, act)
                    if dedup_key in seen_patterns:
                        continue
                    order_count = sum(
                        1 for i in act_trace_indices
                        if check_order(aligned_traces[i]['alignment'], ins_act, act)
                    )
                    if order_count > 0:
                        seen_patterns.add(dedup_key)
                        patterns.append({
                            'pattern_type': 'wrong_order',
                            'activity': act,
                            'description': (
                                f'"{ins_act}" is inserted while "{act}" is skipped in '
                                f'{order_count}/{n_deviating} deviating traces ({100*order_count/n_deviating:.1f}%), '
                                f'suggesting activities were executed in the wrong order'
                            ),
                            'support_count': order_count,
                            'total_deviating': n_deviating,
                            'support_pct': round(100 * order_count / n_deviating, 1),
                            'swap_partner': ins_act,
                        })

            # 7. Unusual neighbor for skipped activities
            # Uses alignment context neighbors (activities around the skip position)
            nb_counter = defaultdict(int)
            for i in act_trace_indices:
                nbs = _get_alignment_context_neighbors(aligned_traces[i]['alignment'], act, is_skip=True)
                for nb in nbs:
                    nb_counter[nb] += 1

            # Build reference: neighbor frequency around act in conforming (non-deviating) traces
            conforming_nb_counter = defaultdict(int)
            conforming_count = 0
            skip_deviating_set = set(act_trace_indices)
            for i in range(len(log)):
                if i in skip_deviating_set:
                    continue
                alignment = aligned_traces[i]['alignment']
                # Conforming trace for this act: act appears as a sync move
                if not any(lm == act and mm == act for lm, mm in alignment):
                    continue
                conforming_count += 1
                trace_acts = [event['concept:name'] for event in log[i] if 'concept:name' in event]
                for j, a in enumerate(trace_acts):
                    if a != act:
                        continue
                    if j > 0:
                        conforming_nb_counter[trace_acts[j - 1]] += 1
                    if j < len(trace_acts) - 1:
                        conforming_nb_counter[trace_acts[j + 1]] += 1

            unusual_skip_nbs = []
            for nb, count in nb_counter.items():
                dev_freq = count / n_act if n_act > 0 else 0
                global_freq = conforming_nb_counter[nb] / conforming_count if conforming_count > 0 else 0
                if dev_freq > global_freq * 1.5 and count >= 2:
                    unusual_skip_nbs.append((nb, count))

            if unusual_skip_nbs:
                unusual_skip_nbs.sort(key=lambda x: -x[1])
                nb_names = [nb for nb, _ in unusual_skip_nbs[:3]]
                top_support = unusual_skip_nbs[0][1]
                patterns.append({
                    'pattern_type': 'unusual_neighbor',
                    'activity': act,
                    'description': (
                        f'Traces where "{act}" is skipped show unusual neighboring activities '
                        f'({", ".join(nb_names)}) compared to conforming traces in '
                        f'{top_support}/{n_deviating} cases ({100*top_support/n_deviating:.1f}%)'
                    ),
                    'support_count': top_support,
                    'total_deviating': n_deviating,
                    'support_pct': round(100 * top_support / n_deviating, 1),
                    'unusual_neighbors': nb_names,
                })

        # Sort by support_pct descending so strongest signals appear first
        patterns.sort(key=lambda x: -x['support_pct'])
        result[issue_name] = patterns

    return result
